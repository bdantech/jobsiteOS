import type { RealtimeChannel } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import Constants from 'expo-constants'
import { Dimensions, Platform } from 'react-native'
import {
  lerEstadoBeta,
  montarContexto,
  type ContextoReport,
  type EstadoBeta,
  type PrioridadeReport,
  type StatusReport,
  type TipoReport,
} from '@jobsiteos/core'

import { useSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * Reportar bugs & melhorias no celular (04m).
 *
 * As leituras e escritas são as MESMAS da web — mesmas tabelas, mesmas RPCs.
 * A única diferença é de onde vem o contexto: Platform.OS e Dimensions no lugar
 * de navigator e window, montados pelo mesmo helper do core para que o painel de
 * triagem leia os dois lados com a mesma tela.
 *
 * O que NÃO vem para cá: o painel de triagem. `admin` é webOnly no registry, e
 * mudar status de report não é trabalho de campo.
 */

export const reportsKeys = {
  todos: ['reports'] as const,
  meus: () => ['reports', 'meus'] as const,
  um: (id: string) => ['reports', 'um', id] as const,
  comentarios: (id: string) => ['reports', 'comentarios', id] as const,
  beta: () => ['reports', 'beta'] as const,
}

export interface ReportMobile {
  id: string
  numero: number
  tipo: TipoReport
  titulo: string
  descricao: string
  status: StatusReport
  prioridade: PrioridadeReport | null
  contexto: Record<string, unknown> | null
  criado_em: string
}

const CAMPOS = 'id, numero, tipo, titulo, descricao, status, prioridade, contexto, criado_em'

export function useMeusReports(habilitado = true) {
  const { usuario } = useSession()
  const usuarioId = usuario?.id ?? null

  return useQuery({
    queryKey: [...reportsKeys.meus(), usuarioId],
    enabled: habilitado && usuarioId !== null,
    queryFn: async (): Promise<ReportMobile[]> => {
      /*
       * O `eq` é redundante com a RLS para quem NÃO é admin — e não é para quem
       * é. `admin` é webOnly, mas quem administra continua usando o celular para
       * os outros módulos, e o botão de reportar está em todo header. Sem o
       * filtro, a aba que promete "Meus reports" abriria com a fila da empresa.
       */
      const { data, error } = await supabase
        .from('reports')
        .select(CAMPOS)
        .eq('criado_por', usuarioId as string)
        .order('criado_em', { ascending: false })
        .limit(50)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ReportMobile[]
    },
  })
}

export function useReport(id: string | null) {
  return useQuery({
    queryKey: reportsKeys.um(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<ReportMobile | null> => {
      const { data, error } = await supabase
        .from('reports')
        .select(CAMPOS)
        .eq('id', id as string)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as unknown as ReportMobile | null
    },
  })
}

export interface ComentarioMobile {
  id: string
  texto: string
  criado_em: string
  autor_nome: string | null
}

export function useComentarios(reportId: string | null) {
  return useQuery({
    queryKey: reportsKeys.comentarios(reportId ?? ''),
    enabled: Boolean(reportId),
    queryFn: async (): Promise<ComentarioMobile[]> => {
      // Os internos não chegam: a policy não entrega a linha. Não há filtro aqui
      // porque não há nada a filtrar.
      const { data, error } = await supabase
        .from('report_comentarios')
        .select('id, texto, criado_em, usuarios!report_comentarios_autor_id_fkey ( nome )')
        .eq('report_id', reportId as string)
        .order('criado_em', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []).map((c) => {
        const linha = c as unknown as { id: string; texto: string; criado_em: string; usuarios?: { nome: string } | null }
        return {
          id: linha.id,
          texto: linha.texto,
          criado_em: linha.criado_em,
          autor_nome: linha.usuarios?.nome ?? null,
        }
      })
    },
  })
}

/**
 * O contexto do celular.
 *
 * Sem URL e sem user agent — o app não tem nem um nem outro, e inventar a partir
 * da rota faria o painel de triagem mostrar um endereço que não existe. Ausente é
 * `null`, e o helper compartilhado já sabe omitir o que é nulo.
 */
export function contextoDoApp(rota: string | null): ContextoReport {
  const janela = Dimensions.get('window')
  return montarContexto({
    rota,
    plataforma: Platform.OS,
    viewport: { largura: janela.width, altura: janela.height },
    appVersao: Constants.expoConfig?.version ?? null,
  })
}

export function useCriarReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      tipo: TipoReport
      titulo: string
      descricao: string
      contexto: ContextoReport
      anexoUri?: string | null
      /** `mimeType` do asset do ImagePicker. Ausente, assume JPEG. */
      anexoTipo?: string | null
    }) => {
      const anexo = v.anexoUri ? await subirAnexo(v.anexoUri, v.anexoTipo) : null
      const { data, error } = await supabase.rpc('app_report_criar', {
        p: {
          tipo: v.tipo,
          titulo: v.titulo,
          descricao: v.descricao,
          contexto: v.contexto,
          anexo_url: anexo,
        } as never,
      })
      if (error) throw new Error(error.message)
      return data as unknown as { id: string; numero: number }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportsKeys.todos })
    },
  })
}

export function useComentarReport(reportId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (texto: string) => {
      const { error } = await supabase.rpc('app_report_comentar', {
        p: { report_id: reportId, texto } as never,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportsKeys.comentarios(reportId) })
    },
  })
}

/**
 * Os formatos que o bucket aceita (declarados em `allowed_mime_types`, migração
 * 0141). A lista está aqui de novo para o recado ser em português: sem ela, uma
 * foto HEIC da galeria do iPhone voltaria como erro cru do Storage — e HEIC é
 * exatamente o que o iOS entrega quando o ImagePicker não transcodifica.
 */
const TIPOS_ACEITOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * O print vai direto para o bucket privado, pelo mesmo caminho da web.
 *
 * `{usuario_id}/{arquivo}`: o primeiro segmento é o que a policy do Storage usa
 * como âncora, e o report ainda não existe para servir de chave.
 */
async function subirAnexo(uri: string, tipo?: string | null): Promise<string> {
  const { data: sessao } = await supabase.auth.getUser()
  const uid = sessao.user?.id
  if (!uid) throw new Error('Sua sessão expirou. Entre novamente.')

  // O ImagePicker com `quality` reencoda para JPEG na maioria dos casos, mas não
  // em todos — e gravar bytes de PNG anunciando `image/jpeg` faria o navegador do
  // admin depender de adivinhação para exibir o anexo.
  const mime = (tipo ?? 'image/jpeg').toLowerCase()
  const extensao = TIPOS_ACEITOS[mime]
  if (!extensao) {
    throw new Error('Formato de imagem não aceito. Use JPG, PNG, WEBP ou GIF.')
  }

  const resposta = await fetch(uri)
  const bytes = await resposta.arrayBuffer()
  const caminho = `${uid}/${Date.now()}-foto.${extensao}`
  const { error } = await supabase.storage
    .from('report-anexos')
    .upload(caminho, bytes, { contentType: mime, upsert: false })
  if (error) throw new Error(`Não foi possível enviar a imagem: ${error.message}`)
  return caminho
}

/*
 * ─── O canal do modo beta é UM SÓ, para o app inteiro ───────────────────────
 *
 * <BannerBeta> é montado pelo `screenLayout` de CADA tela do stack, e um native
 * stack mantém as telas anteriores vivas: navegar três níveis deixa três banners
 * montados. Uma assinatura por instância abriria três canais no mesmo tópico —
 * três joins, três entregas da mesma linha, e a chance de o Realtime rejeitar a
 * duplicata.
 *
 * O desenho é o mesmo do sino (features/notificacoes/queries.ts): canal em
 * escopo de módulo, conjunto de ouvintes e contagem de referências. O último a
 * desmontar derruba o canal.
 */
type Ouvinte = () => void
const ouvintes = new Set<Ouvinte>()
let canalBeta: RealtimeChannel | null = null

function derrubarCanal(): void {
  if (!canalBeta) return
  void supabase.removeChannel(canalBeta)
  canalBeta = null
}

function garantirCanal(): void {
  if (canalBeta) return

  canalBeta = supabase
    .channel('app-config-beta')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_config', filter: 'chave=eq.beta' },
      () => {
        for (const o of [...ouvintes]) o()
      },
    )
    .subscribe((status) => {
      // Ressincroniza ao ficar vivo e a cada reconexão — o celular perde e
      // recupera rede o tempo todo, e é exatamente aí que uma tarja ligada no
      // meio do caminho passaria despercebida.
      if (status === 'SUBSCRIBED') for (const o of [...ouvintes]) o()
    })
}

/**
 * O modo beta (§5), ao vivo.
 *
 * `app_config` está na publicação de Realtime desde a 0141. `setAuth` com o token
 * do socket porque o Realtime avalia a RLS com o JWT da CONEXÃO, e não com o do
 * cliente REST — sem isso a assinatura conecta e nunca recebe linha nenhuma.
 */
export function useBeta(): EstadoBeta {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: reportsKeys.beta(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EstadoBeta> => {
      const { data, error } = await supabase
        .from('app_config')
        .select('valor')
        .eq('chave', 'beta')
        .maybeSingle()
      if (error) throw new Error(error.message)
      return lerEstadoBeta(data?.valor)
    },
  })

  useEffect(() => {
    let cancelado = false
    const ouvinte: Ouvinte = () => {
      void qc.invalidateQueries({ queryKey: reportsKeys.beta() })
    }
    ouvintes.add(ouvinte)

    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token
      if (!token || cancelado) return
      supabase.realtime.setAuth(token)
      garantirCanal()
    })

    return () => {
      cancelado = true
      ouvintes.delete(ouvinte)
      if (ouvintes.size === 0) derrubarCanal()
    }
  }, [qc])

  // Enquanto carrega (e se falhar), DESLIGADO: piscar uma tarja âmbar a cada
  // navegação seria pior que o aviso vale.
  return query.data ?? { habilitado: false, texto: '' }
}
