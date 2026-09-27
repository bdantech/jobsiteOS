'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  arquivarModeloCobranca,
  calcularPerdaSegurada,
  canAccessRoute,
  configCobrancaApoliceSchema,
  configCobrancaCalculoSchema,
  configCobrancaCredorSchema,
  configCobrancaGeralSchema,
  configCobrancaProtestoSchema,
  configCobrancaRegularizacaoSchema,
  custoSinistroSchema,
  criarSinistro,
  custoSinistro,
  definirCobrancaConfig,
  documentoSinistro,
  estimativaSinistro,
  moverSinistro,
  registrarInsolvencia,
  regularizarSacado,
  salvarApolice,
  salvarModeloCobranca,
  solicitacaoSinistro,
  tipoModeloCobrancaSchema,
  validarModeloCobranca,
  type CobrancaConfigChave,
  type CreditosComprador,
  type FieldErrors,
  type Json,
  type ResultadoPerda,
  type Tables,
  type TipoModeloCobranca,
} from '@jobsiteos/core'
import type { z } from 'zod'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararDossieSinistro, dispararEnvioSeguradora } from '@/lib/mercado/worker'

/**
 * Mutações da GESTÃO da Cobrança (Prompt 07 — painel, sinistros, protestos, modelos e
 * settings). Mesmo desenho do Jurídico: tudo por RPC SECURITY DEFINER com o client do
 * USUÁRIO, e a RPC é quem decide se a pessoa é gestora. A action só barra quem nem tem
 * o módulo, para a mensagem sair em pt-BR antes de uma ida ao banco.
 *
 * As escritas das cobranças em si (criar, notificar, acordo, protesto por cobrança)
 * moram em `actions/cobranca.ts`, que é de outra frente.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = { ok: false, message: 'Você não tem acesso ao módulo Cobrança.', code: 'forbidden' }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/cobranca', context.grantedModuleIds)) {
    return { erro: SEM_MODULO as Falha, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

function revalidarSinistro(id?: string): void {
  revalidatePath('/cobranca')
  revalidatePath('/cobranca/sinistros')
  if (id) revalidatePath(`/cobranca/sinistros/${id}`)
}

// ─── §11 Regularização do sacado ────────────────────────────────────────────

export interface ResultadoRegularizacao {
  sacado_matriz_cnpj: string
  pago_em: string | null
  prazos_encerrados: number
  cobertura_volta_em: string | null
  revisao_pos_inadimplencia: boolean
}

/**
 * Gestor apenas (a RPC confere). A RPC também recusa quitação parcial e protesto sem
 * instrução de cancelamento — a tela mostra os dois antes, mas quem decide é o banco.
 */
export async function regularizarSacadoAction(sacadoMatrizCnpj: string): Promise<ActionResult<ResultadoRegularizacao>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = (await regularizarSacado(supabase, { sacado_matriz_cnpj: sacadoMatrizCnpj })) as unknown as ResultadoRegularizacao
    revalidatePath('/cobranca')
    revalidatePath('/cobranca/cobrancas')
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §13 Settings ───────────────────────────────────────────────────────────

/*
 * A RPC grava qualquer objeto na chave. Validar aqui com o schema do core é o que
 * impede uma seção meio preenchida de ser salva — e `lerCobrancaConfig` troca uma
 * seção malformada pelo padrão INTEIRO, em silêncio. Sem esta guarda, um prazo
 * digitado errado viraria o default de fábrica na próxima leitura.
 */
const SCHEMA_DA_CHAVE: Record<CobrancaConfigChave, z.ZodTypeAny> = {
  cobranca: configCobrancaGeralSchema,
  calculo: configCobrancaCalculoSchema,
  apolice: configCobrancaApoliceSchema,
  protesto: configCobrancaProtestoSchema,
  regularizacao: configCobrancaRegularizacaoSchema,
  credor: configCobrancaCredorSchema,
}

export async function salvarCobrancaConfigAction(
  chave: CobrancaConfigChave,
  valor: unknown,
): Promise<ActionResult<Tables<'cobranca_config'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  const schema = SCHEMA_DA_CHAVE[chave]
  if (!schema) return { ok: false, message: 'Seção de configuração desconhecida.', code: 'validation' }
  const r = schema.safeParse(valor)
  if (!r.success) {
    const primeira = r.error.issues[0]
    return {
      ok: false,
      code: 'validation',
      message: primeira
        ? `Configuração inválida em "${primeira.path.join('.') || chave}": ${primeira.message}`
        : 'Configuração inválida.',
    }
  }

  try {
    const c = await definirCobrancaConfig(supabase, { chave, valor: r.data as Record<string, unknown> })
    revalidatePath('/cobranca/config')
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarApoliceAction(input: unknown): Promise<ActionResult<Tables<'apolices'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await salvarApolice(supabase, input)
    revalidatePath('/cobranca/config')
    revalidatePath('/cobranca')
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §5 Modelos ─────────────────────────────────────────────────────────────

/**
 * Salvar é sempre uma VERSÃO NOVA da família (a RPC desativa a anterior): a
 * notificação de março continua apontando para o texto de março.
 *
 * O placeholder desconhecido é conferido aqui antes da RPC — que confere de novo —
 * porque daqui a mensagem volta com a LISTA, e a tela marca cada um no editor.
 */
export async function salvarModeloAction(input: {
  id?: string
  tipo?: TipoModeloCobranca
  nome?: string
  corpo_markdown: string
}): Promise<ActionResult<Tables<'cobranca_modelos'>> & { desconhecidos?: string[] }> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  let tipo = input.tipo
  if (input.id) {
    const { data } = await supabase.from('cobranca_modelos').select('tipo').eq('id', input.id).maybeSingle()
    if (!data) return { ok: false, message: 'Modelo não encontrado.', code: 'not_found' }
    tipo = tipoModeloCobrancaSchema.parse(data.tipo)
  }
  if (!tipo) return { ok: false, message: 'Escolha o tipo do modelo.', code: 'validation' }

  const { desconhecidos } = validarModeloCobranca(tipo, input.corpo_markdown)
  if (desconhecidos.length) {
    return {
      ok: false,
      code: 'placeholder_desconhecido',
      message: `Placeholder desconhecido: ${desconhecidos.map((p) => `{{${p}}}`).join(', ')}.`,
      desconhecidos,
    }
  }

  try {
    const m = await salvarModeloCobranca(supabase, {
      id: input.id,
      tipo: input.id ? undefined : tipo,
      nome: input.nome?.trim() || undefined,
      corpo_markdown: input.corpo_markdown,
    })
    revalidatePath('/cobranca/modelos')
    return { ok: true, data: m }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Arquivar tira a família inteira de uso (nenhuma versão ativa). Não há wrapper no core
 * para esta RPC — é a única escrita daqui que chama o `rpc` direto.
 */
export async function arquivarModeloAction(familiaId: string): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    await arquivarModeloCobranca(supabase, { familia_id: familiaId })
    revalidatePath('/cobranca/modelos')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §6.1 Insolvência ───────────────────────────────────────────────────────

/**
 * Registrar ou CONFIRMAR. A detecção automática do Jurídico usa a data de distribuição
 * (anterior à decisão, o lado seguro); confirmar é gravar a data da decisão por cima,
 * e o relógio recalcula o prazo de envio a partir dela.
 */
export async function registrarInsolvenciaAction(
  input: unknown,
): Promise<ActionResult<Tables<'cobranca_insolvencias'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const i = await registrarInsolvencia(supabase, input)
    revalidatePath('/cobranca')
    return { ok: true, data: i }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §7 Sinistro ────────────────────────────────────────────────────────────

export async function criarSinistroAction(input: unknown): Promise<ActionResult<Tables<'sinistros'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const s = await criarSinistro(supabase, input)
    revalidarSinistro(s.id)
    if (s.cobranca_id) revalidatePath(`/cobranca/cobrancas/${s.cobranca_id}`)
    return { ok: true, data: s }
  } catch (e) {
    // 23505 aqui é "o título já está em outro sinistro"; o tradutor genérico diria só
    // "registro duplicado", que não aponta o que fazer.
    if (e instanceof MutationError && e.code === 'duplicate') {
      return { ok: false, code: 'duplicate', message: 'Um dos títulos escolhidos já está em outro sinistro em andamento.' }
    }
    return falhaDe(e)
  }
}

/** Anexar (depois do upload pelo browser em `sinistros/{id}/…`), não aplicável ou reabrir. */
export async function documentoSinistroAction(input: {
  sinistro_id: string
  item: string
  acao: 'anexar' | 'nao_aplicavel' | 'reabrir'
  arquivo_path?: string
  arquivo_hash?: string
  justificativa?: string
}): Promise<ActionResult<Tables<'sinistro_documentos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const d = await documentoSinistro(supabase, input)
    revalidarSinistro(input.sinistro_id)
    return { ok: true, data: d }
  } catch (e) {
    return falhaDe(e)
  }
}

export interface EstimativaCalculada {
  resultado: ResultadoPerda
  limite_credito_vigente: number | null
  percentagem_segurada: number
  franquia: number
  creditos: CreditosComprador
}

/**
 * §7.3 — a conta roda AQUI, com o motor do core, sobre o que o banco diz: os títulos
 * do sinistro (face, valor cedido, cobertura), a apólice (percentagem e franquia) e o
 * limite vigente do comprador. Do formulário vêm só os créditos do comprador, que
 * nenhuma tabela conhece inteiros (nota de crédito, compensação, revenda de bem…).
 *
 * O limite é o MAIOR `limite_credito_vigente` entre os títulos do grupo: a projeção
 * repete o limite da análise do sacado em cada título, e um título antigo pode
 * carregar o limite de uma análise vencida — o maior é o vigente mais recente, e
 * errar para cima aqui só significa não aplicar um teto que a seguradora aplicaria.
 * `null` quando nenhum título informa: a memória diz isso em vez de inventar.
 */
export async function calcularEstimativaSinistroAction(input: {
  sinistro_id: string
  creditos: CreditosComprador
}): Promise<ActionResult<EstimativaCalculada>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  try {
    const { data: s, error: e1 } = await supabase
      .from('sinistros')
      .select('id, apolice_id, sacado_matriz_cnpj')
      .eq('id', input.sinistro_id)
      .maybeSingle()
    if (e1) throw new MutationError('Não foi possível ler o sinistro.', 'unknown')
    if (!s) return { ok: false, message: 'Sinistro não encontrado.', code: 'not_found' }

    const [{ data: st }, { data: apolice }, { data: limites }] = await Promise.all([
      supabase.from('sinistro_titulos').select('titulo_id, valor_face, valor_cedido').eq('sinistro_id', s.id),
      supabase.from('apolices').select('percentagem_segurada, franquia').eq('id', s.apolice_id).maybeSingle(),
      supabase
        .from('titulos')
        .select('limite_credito_vigente')
        .eq('sacado_matriz_cnpj', s.sacado_matriz_cnpj)
        .not('limite_credito_vigente', 'is', null)
        .order('limite_credito_vigente', { ascending: false })
        .limit(1),
    ])
    if (!st?.length) return { ok: false, message: 'O sinistro não tem títulos.', code: 'validation' }
    if (!apolice) return { ok: false, message: 'Apólice do sinistro não encontrada.', code: 'not_found' }

    const { data: titulos } = await supabase
      .from('titulos')
      .select('id, numero, externo_id, coberto_apolice, valor_cedido')
      .in(
        'id',
        st.map((t) => t.titulo_id).filter((id): id is string => id !== null),
      )
    const porId = new Map((titulos ?? []).map((t) => [t.id, t]))

    const limite = limites?.[0]?.limite_credito_vigente
    const creditos = Object.fromEntries(
      Object.entries(input.creditos).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0),
    ) as CreditosComprador

    const resultado = calcularPerdaSegurada({
      titulos: st.map((l) => {
        const t = l.titulo_id ? porId.get(l.titulo_id) : undefined
        // O snapshot do sinistro primeiro: é o que foi para o dossiê. O título vivo só
        // completa o valor cedido quando o snapshot nasceu sem ele.
        const cedido = l.valor_cedido ?? t?.valor_cedido ?? null
        return {
          id: l.titulo_id ?? '',
          descricao: t?.numero ?? t?.externo_id ?? 'título',
          valor_devido: Number(l.valor_face),
          segurado: t?.coberto_apolice ?? true,
          valor_cedido: cedido === null ? null : Number(cedido),
        }
      }),
      creditos,
      percentagem_segurada: Number(apolice.percentagem_segurada),
      franquia: Number(apolice.franquia),
      limite_credito_vigente: limite === null || limite === undefined ? null : Number(limite),
    })

    await estimativaSinistro(supabase, {
      sinistro_id: s.id,
      perda_segurada_estimada: resultado.perda_segurada,
      indenizacao_estimada: resultado.indenizacao,
      valor_recebido_parcial: creditos.pagamentos ?? 0,
      memoria_perda: {
        ...resultado,
        entrada: {
          creditos,
          limite_credito_vigente: limite ?? null,
          percentagem_segurada: Number(apolice.percentagem_segurada),
          franquia: Number(apolice.franquia),
        },
        calculado_em: new Date().toISOString(),
      } as unknown as Json,
    })

    revalidarSinistro(s.id)
    return {
      ok: true,
      data: {
        resultado,
        limite_credito_vigente: limite === null || limite === undefined ? null : Number(limite),
        percentagem_segurada: Number(apolice.percentagem_segurada),
        franquia: Number(apolice.franquia),
        creditos,
      },
    }
  } catch (e) {
    return falhaDe(e)
  }
}

type EstagioSinistroDestino =
  | 'notificado'
  | 'enviado'
  | 'em_analise'
  | 'docs_pendentes'
  | 'aceito'
  | 'recusado'
  | 'indenizado'
  | 'encerrado'

export interface MoverSinistroInput {
  sinistro_id: string
  estagio: EstagioSinistroDestino
  data?: string
  protocolo_externo?: string
  motivo_recusa?: string
  indenizacao_recebida?: number
  justificativa_prova_entrega?: string
  /**
   * "Já notifiquei/enviei por fora": só registra, com o protocolo que a pessoa colou.
   * O prazo da apólice NUNCA depende do transporte (§7.4) — se o e-mail do sistema ou a
   * API cair, este é o caminho que continua de pé no mesmo botão.
   */
  por_fora?: boolean
}

export interface SinistroMovido {
  sinistro: Tables<'sinistros'>
  modo: 'manual' | 'api' | 'registro'
  mensagem: string | null
}

/**
 * Pré-condições do `enviado`, conferidas ANTES de mandar qualquer coisa à seguradora.
 * A RPC confere de novo, mas se só ela conferisse o e-mail já teria saído quando ela
 * recusasse — e um dossiê incompleto na caixa da seguradora não se desmanda.
 */
async function conferirEnvio(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sinistroId: string,
  justificativa: string | undefined,
): Promise<Falha | null> {
  const { data: s } = await supabase
    .from('sinistros')
    .select('cobranca_id, justificativa_prova_entrega')
    .eq('id', sinistroId)
    .maybeSingle()
  if (!s) return { ok: false, message: 'Sinistro não encontrado.', code: 'not_found' }

  const { data: pendentes } = await supabase
    .from('sinistro_documentos')
    .select('item, descricao')
    .eq('sinistro_id', sinistroId)
    .eq('obrigatorio', true)
    .eq('status', 'pendente')
    .order('item')
  if (pendentes?.length) {
    return {
      ok: false,
      code: 'checklist',
      message: `Checklist incompleto: ${pendentes.map((p) => `${p.item}) ${p.descricao}`).join('; ')}.`,
    }
  }

  if (s.cobranca_id) {
    const { data: notifs } = await supabase
      .from('cobranca_notificacoes')
      .select('id, cobranca_notificacao_entregas(status)')
      .eq('cobranca_id', s.cobranca_id)
      .in('status', ['enviada', 'entregue', 'respondida'])
    const semProva = (notifs ?? []).filter(
      (n) => !(n.cobranca_notificacao_entregas ?? []).some((e) => e.status === 'entregue'),
    ).length
    const just = (justificativa ?? s.justificativa_prova_entrega ?? '').trim()
    if (semProva > 0 && just.length < 10) {
      return {
        ok: false,
        code: 'prova_entrega',
        message: `${semProva} notificação(ões) sem prova de entrega. Registre o AR/certidão na cobrança ou justifique a ausência (mín. 10 caracteres).`,
      }
    }
  }
  return null
}

export async function moverSinistroAction(input: MoverSinistroInput): Promise<ActionResult<SinistroMovido>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  const pelaSeguradora = (input.estagio === 'notificado' || input.estagio === 'enviado') && !input.por_fora

  try {
    if (input.estagio === 'enviado') {
      const bloqueio = await conferirEnvio(supabase, input.sinistro_id, input.justificativa_prova_entrega)
      if (bloqueio) return bloqueio
    }

    let protocolo = input.protocolo_externo?.trim() || undefined
    let modo: SinistroMovido['modo'] = 'registro'
    let mensagem: string | null = null

    if (pelaSeguradora) {
      const r = await dispararEnvioSeguradora({
        sinistro_id: input.sinistro_id,
        acao: input.estagio === 'notificado' ? 'notificar' : 'enviar',
      })
      if (!r.ok) {
        return {
          ok: false,
          code: 'envio',
          message: `${r.message} Nada foi registrado. Se já comunicou a seguradora por outro meio, use "Já ${
            input.estagio === 'notificado' ? 'notifiquei' : 'enviei'
          } por fora" com o protocolo — o prazo não espera o sistema.`,
        }
      }
      const corpo = (r.corpo ?? {}) as { ok?: boolean; modo?: 'manual' | 'api'; protocolo?: string; mensagem?: string }
      if (corpo.ok !== true) {
        return {
          ok: false,
          code: 'envio',
          message: `${corpo.mensagem ?? 'A seguradora não confirmou o recebimento.'} Nada foi registrado; use o registro manual com o protocolo se já comunicou por fora.`,
        }
      }
      protocolo = corpo.protocolo ?? protocolo
      modo = corpo.modo ?? 'manual'
      mensagem = corpo.mensagem ?? null
    }

    try {
      const s = await moverSinistro(supabase, {
        sinistro_id: input.sinistro_id,
        estagio: input.estagio,
        data: input.data || undefined,
        protocolo_externo: protocolo,
        motivo_recusa: input.motivo_recusa?.trim() || undefined,
        indenizacao_recebida: input.indenizacao_recebida,
        modo_envio: modo === 'registro' ? undefined : modo,
        justificativa_prova_entrega: input.justificativa_prova_entrega?.trim() || undefined,
      })
      revalidarSinistro(s.id)
      return { ok: true, data: { sinistro: s, modo, mensagem } }
    } catch (e) {
      if (pelaSeguradora) {
        // A comunicação JÁ saiu. Dizer só "falhou" levaria alguém a mandar de novo.
        const f = falhaDe(e)
        return {
          ...f,
          message: `A seguradora foi comunicada${protocolo ? ` (protocolo ${protocolo})` : ''}, mas o registro falhou: ${f.message} Registre com "por fora" usando esse protocolo — não reenvie.`,
        }
      }
      throw e
    }
  } catch (e) {
    return falhaDe(e)
  }
}

export interface DossieGerado {
  dossie_path: string | null
  dossie_hash: string | null
  pendencias: string[]
  itens_gerados: string[]
}

export async function gerarDossieAction(sinistroId: string): Promise<ActionResult<DossieGerado>> {
  const { erro } = await autorizar()
  if (erro) return erro

  const r = await dispararDossieSinistro(sinistroId)
  if (!r.ok) return { ok: false, message: r.message, code: r.code }

  const corpo = (r.corpo ?? {}) as Partial<DossieGerado>
  revalidarSinistro(sinistroId)
  return {
    ok: true,
    data: {
      dossie_path: corpo.dossie_path ?? null,
      dossie_hash: corpo.dossie_hash ?? null,
      pendencias: corpo.pendencias ?? [],
      itens_gerados: corpo.itens_gerados ?? [],
    },
  }
}

/** Sem `id`: pedido novo da seguradora (prazo = solicitação + dias da apólice). Com `id`: respondida. */
export async function solicitacaoSinistroAction(input: {
  id?: string
  sinistro_id?: string
  descricao?: string
  solicitada_em?: string
  respondida_em?: string
}): Promise<ActionResult<Tables<'sinistro_solicitacoes'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const s = await solicitacaoSinistro(supabase, input)
    revalidarSinistro(s.sinistro_id)
    return { ok: true, data: s }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function custoSinistroAction(
  input: z.input<typeof custoSinistroSchema>,
): Promise<ActionResult<Tables<'sinistro_custos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await custoSinistro(supabase, input)
    revalidarSinistro(c.sinistro_id ?? undefined)
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}
