import type { Campo, PerguntaIntencao } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

export const leadsKeys = {
  all: ['leads'] as const,
  formularios: () => [...leadsKeys.all, 'formularios'] as const,
  formulario: (id: string) => [...leadsKeys.all, 'formulario', id] as const,
  submissoes: (formularioId: string | null) => [...leadsKeys.all, 'submissoes', formularioId] as const,
}

export interface FormularioLinha {
  id: string
  slug: string
  nome: string
  descricao: string | null
  ativo: boolean
  criado_em: string
  enriquecimento_pago: boolean
  vendedor_destino_id: string | null
  vendedor_destino_nome: string | null
  visualizacoes: number
  submissoes: number
  em_revisao: number
  spam: number
  reunioes: number
}

export async function buscarFormularios(): Promise<FormularioLinha[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('formularios_lista')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as FormularioLinha[]
}

export interface FormularioCompleto {
  id: string
  slug: string
  nome: string
  descricao: string | null
  titulo: string | null
  subtitulo: string | null
  texto_botao: string
  mensagem_sucesso: string | null
  ajuda_cnpj: string | null
  campos: Campo[]
  pergunta_intencao: PerguntaIntencao | null
  consentimento_texto: string | null
  consentimento_obrigatorio: boolean
  vendedor_destino_id: string | null
  auto_resposta_habilitada: boolean
  auto_resposta_assunto: string | null
  auto_resposta_corpo: string | null
  enriquecimento_pago: boolean
  ativo: boolean
}

export async function buscarFormulario(id: string): Promise<FormularioCompleto | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('formularios').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as FormularioCompleto) ?? null
}

export interface Submissao {
  id: string
  formulario_id: string | null
  dados: Record<string, unknown>
  intencao: string | null
  status: string
  motivo_revisao: string | null
  divergencia_papel: boolean
  cnpj: string | null
  empresa_id: string | null
  utm_source: string | null
  utm_campaign: string | null
  pagina_url: string | null
  erro: string | null
  criada_em: string
}

/**
 * A aba "Submissões" mostra TUDO, inclusive `descartada_spam` e `erro`.
 *
 * É de propósito: a pergunta que essa aba responde é "o lead do fulano chegou?", e uma
 * lista que esconde o que deu errado responde "não chegou" para os dois casos em que
 * chegou e foi barrado.
 */
export async function buscarSubmissoes(formularioId: string | null): Promise<Submissao[]> {
  const supabase = createClient()
  let q = supabase
    .from('formulario_submissoes')
    .select(
      'id, formulario_id, dados, intencao, status, motivo_revisao, divergencia_papel, cnpj, empresa_id, utm_source, utm_campaign, pagina_url, erro, criada_em',
    )
    .order('criada_em', { ascending: false })
    .limit(300)
  if (formularioId) q = q.eq('formulario_id', formularioId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Submissao[]
}
