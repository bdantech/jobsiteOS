'use server'

import { revalidatePath } from 'next/cache'
import {
  AVISO_APOLICE_COBRANCA,
  ErroAgrupamento,
  MutationError,
  aceitarAvisoApolice,
  agruparNotificacoes,
  anexarAcordoAssinado,
  anexarArquivoProtesto,
  atualizarCobranca,
  atualizarDadosMinuta,
  atualizarDividaCobranca,
  atualizarTituloProtesto,
  canAccessRoute,
  cancelarAcordo,
  criarCobranca,
  criarProcessoCobranca,
  criarRemessaProtesto,
  criarSinistro,
  editarNotificacaoCobranca,
  enviarNotificacaoCobranca,
  gerarRemessaProtestoCsv,
  hojeSaoPaulo,
  instrucaoCancelamentoProtesto,
  lerCobrancaConfig,
  lerRetornoProtesto,
  marcarRemessaEnviada,
  moverCobranca,
  processarRetornoProtesto,
  quitarTituloCobranca,
  registrarEntregaCobranca,
  registrarInteracaoCobranca,
  retirarTituloCobranca,
  salvarAcordo,
  salvarNotificacoesCobranca,
  simularParcelamento,
  somarDiasCorridos,
  somarDiasUteis,
  vincularProcessoCobranca,
  formatarEndereco,
  type CobrancaConfig,
  type EnderecoDestinatario,
  type FieldErrors,
  type IndiceCobranca,
  type LinhaRemessaProtesto,
  type NotificacaoParaSalvar,
  type ParametrosAtualizacao,
  type PapelNotificacaoCobranca,
  type SimulacaoParcelamentoInput,
  type TabelaIndices,
  type Tables,
  type TipoModeloCobranca,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { dispararDocumentosCobranca } from '@/lib/mercado/worker'

/**
 * Mutações da frente de cobranças (Prompt 07: §1, §4, §5, §8, §9, §10). Escrita sempre
 * pelos RPCs SECURITY DEFINER das migrações 0269d/0269e, com o client do USUÁRIO — a
 * guarda do módulo e as invariantes (agrupamento, rodada, aceite da apólice) estão no
 * banco. A tela e esta camada só explicam antes; quem recusa é o RPC.
 *
 * O que roda AQUI, no servidor, e não no navegador: a atualização da dívida que vai
 * para a carta (o total impresso não pode ser um número que o cliente editou antes de
 * gravar), a montagem da remessa de protesto e a leitura do retorno do cartório. Os
 * PDFs são do worker (`dispararDocumentosCobranca`), que tem a stack de PDF e grava o
 * hash — o que sai daqui é só o pedido.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }
type Supa = Awaited<ReturnType<typeof createClient>>

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = { ok: false, message: 'Você não tem acesso ao módulo Cobrança.', code: 'forbidden' }
const BUCKET = 'cobrancas'

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null, userId: null }
  if (!canAccessRoute('/cobranca', context.grantedModuleIds)) {
    return { erro: SEM_MODULO as Falha, supabase: null, userId: null }
  }
  return { erro: null, supabase: await createClient(), userId: context.usuario.id }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) {
    // "Dados inválidos." sozinho não diz qual campo; o primeiro erro do zod diz.
    const primeiro = e.fieldErrors ? Object.values(e.fieldErrors).flat().find(Boolean) : undefined
    const message = e.code === 'validation' && primeiro ? `${e.message} ${primeiro}` : e.message
    return { ok: false, message, code: e.code, fieldErrors: e.fieldErrors }
  }
  if (e instanceof ErroAgrupamento) return { ok: false, message: e.message, code: e.codigo }
  if (e instanceof Error && e.message) return { ok: false, message: e.message, code: 'unknown' }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

function revalidar(cobrancaId?: string): void {
  revalidatePath('/cobranca')
  revalidatePath('/cobranca/cobrancas')
  if (cobrancaId) revalidatePath(`/cobranca/cobrancas/${cobrancaId}`)
}

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v)

// ─── §1 Criar e parametrizar ────────────────────────────────────────────────

export async function criarCobrancaAction(input: unknown): Promise<ActionResult<Tables<'cobrancas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await criarCobranca(supabase, input)
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function atualizarCobrancaAction(input: unknown): Promise<ActionResult<Tables<'cobrancas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await atualizarCobranca(supabase, input)
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function moverCobrancaAction(input: unknown): Promise<ActionResult<Tables<'cobrancas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await moverCobranca(supabase, input)
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

/** §6.4 — o aceite do aviso vai com o TEXTO exato para o audit_log. */
export async function aceitarAvisoApoliceAction(cobrancaId: string): Promise<ActionResult<Tables<'cobrancas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await aceitarAvisoApolice(supabase, {
      cobranca_id: cobrancaId,
      aceite: true,
      texto: AVISO_APOLICE_COBRANCA,
    })
    revalidar(c.id)
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §4/§5 Minutas de notificação ───────────────────────────────────────────

export interface ErroDocumento {
  id: string
  destinatario: string
  mensagem: string
}

export interface ResultadoDocumentos {
  gerados: number
  erros: ErroDocumento[]
  /** Preenchido quando o worker nem respondeu: as linhas existem, os PDFs não. */
  aviso: string | null
}

export interface MinutasGeradas extends ResultadoDocumentos {
  rodada: number
  notificacoes: number
  valor_atualizado: number | null
}

type TituloParaMinuta = Tables<'cobranca_titulos'> & {
  titulos: Pick<
    Tables<'titulos'>,
    'numero' | 'externo_id' | 'nf_chave_acesso' | 'sacado_matriz_cnpj' | 'cedente_matriz_cnpj' | 'antecipacao_id_externo'
  > | null
}

type CadastroLinha = {
  cnpj: string
  razao_social: string | null
  empresa_id: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  municipio: string | null
  uf: string | null
  cep: string | null
}

async function lerCadastro(supabase: Supa, cnpjs: readonly string[]): Promise<Map<string, CadastroLinha>> {
  if (cnpjs.length === 0) return new Map()
  const { data, error } = await supabase.rpc('app_cobranca_cadastro', { p_cnpjs: [...new Set(cnpjs)] })
  if (error) throw new MutationError('Não foi possível ler o cadastro dos destinatários.', 'unknown')
  return new Map(((data ?? []) as CadastroLinha[]).map((c) => [c.cnpj, c]))
}

function enderecoDoCadastro(c: CadastroLinha | undefined): EnderecoDestinatario | null {
  if (!c) return null
  const e: EnderecoDestinatario = {
    logradouro: c.logradouro,
    numero: c.numero,
    complemento: null,
    bairro: c.bairro,
    municipio: c.municipio,
    uf: c.uf,
    cep: c.cep,
  }
  return formatarEndereco(e) ? e : null
}

async function lerTabelaIndices(supabase: Supa, indice: IndiceCobranca): Promise<TabelaIndices> {
  if (indice === 'nenhum') return {}
  const { data, error } = await supabase
    .from('juridico_indices')
    .select('competencia, valor')
    .eq('indice', indice)
    .limit(1200)
  if (error) throw new MutationError('Não foi possível ler a tabela de índices.', 'unknown')
  return Object.fromEntries((data ?? []).map((i) => [i.competencia, Number(i.valor)]))
}

/** Parâmetros da cobrança, com o settings por baixo do que ela não sobrescreveu. */
function parametrosDaCobranca(c: Tables<'cobrancas'>, config: CobrancaConfig): ParametrosAtualizacao {
  return {
    juros_mora_mes: num(c.juros_mora_mes) ?? config.calculo.juros_mora_mes,
    multa_pct: num(c.multa_pct) ?? config.calculo.multa_pct,
    honorarios_pct: num(c.honorarios_pct) ?? config.calculo.honorarios_pct,
    indice: (c.indice_correcao as IndiceCobranca | null) ?? config.calculo.indice,
    juros_pro_rata: c.juros_pro_rata ?? config.calculo.juros_pro_rata,
  }
}

function tipoDoModelo(papel: PapelNotificacaoCobranca, rodada: number): TipoModeloCobranca {
  if (rodada > 1) return 'reiteracao'
  return papel.startsWith('cedente_') ? 'notificacao_cedente' : 'notificacao_sacado'
}

/** O corpo síncrono do worker de documentos, lido com desconfiança. */
function lerCorpoDocumentos(corpo: unknown): { gerados: number; erros: { id: string; mensagem: string }[] } {
  const c = (corpo ?? {}) as { gerados?: unknown; erros?: unknown }
  const gerados = Array.isArray(c.gerados) ? c.gerados.length : 0
  const erros = Array.isArray(c.erros)
    ? (c.erros as { id?: unknown; mensagem?: unknown }[]).map((e) => ({
        id: String(e.id ?? ''),
        mensagem: String(e.mensagem ?? 'Falha ao gerar o documento.'),
      }))
    : []
  return { gerados, erros }
}

async function gerarPdfs(
  supabase: Supa,
  notificacaoIds: readonly string[],
): Promise<ResultadoDocumentos> {
  if (notificacaoIds.length === 0) return { gerados: 0, erros: [], aviso: null }
  const r = await dispararDocumentosCobranca({ tipo: 'notificacoes', notificacao_ids: [...notificacaoIds] })
  if (!r.ok) {
    return {
      gerados: 0,
      erros: [],
      aviso: `As minutas foram salvas, mas os PDFs não saíram: ${r.message} Use "Gerar PDF" em cada notificação.`,
    }
  }
  const { gerados, erros } = lerCorpoDocumentos(r.corpo)
  // O worker devolve o id; a tela quer o nome de quem ia receber a carta.
  const { data: nomes } = await supabase
    .from('cobranca_notificacoes')
    .select('id, destinatario_razao_social')
    .in('id', [...notificacaoIds])
  const nomePorId = new Map((nomes ?? []).map((n) => [n.id, n.destinatario_razao_social]))
  return {
    gerados,
    erros: erros.map((e) => ({ ...e, destinatario: nomePorId.get(e.id) ?? e.id })),
    aviso: null,
  }
}

/**
 * Calcula quem recebe o quê (§4), atualiza a dívida de CADA notificação sobre os
 * títulos dela (§9.1), grava a rodada e pede os PDFs.
 *
 * A memória de cálculo gravada é o `ResultadoAtualizacao` inteiro: o worker renderiza a
 * carta a partir dela, e o dossiê a reproduz. Recalcular no worker seria arriscar que a
 * carta mostre um total diferente do que a tela mostrou quando alguém apertou o botão.
 *
 * `rodada` omitida: 1 se não há nenhuma; a mesma se a última ainda está em rascunho
 * (refazer); a seguinte se a última já saiu. O RPC confere a regra de novo.
 */
export async function gerarMinutasNotificacaoAction(
  cobrancaId: string,
  opcoes: { rodada?: number } = {},
): Promise<ActionResult<MinutasGeradas>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  try {
    const [cobrancaQ, titulosQ, configQ, anterioresQ, modelosQ] = await Promise.all([
      supabase.from('cobrancas').select('*').eq('id', cobrancaId).maybeSingle(),
      supabase
        .from('cobranca_titulos')
        .select(
          '*, titulos(numero, externo_id, nf_chave_acesso, sacado_matriz_cnpj, cedente_matriz_cnpj, antecipacao_id_externo)',
        )
        .eq('cobranca_id', cobrancaId),
      supabase.from('cobranca_config').select('chave, valor'),
      supabase
        .from('cobranca_notificacoes')
        .select('rodada, status, destinatario_cnpj, destinatario_razao_social, destinatario_endereco')
        .eq('cobranca_id', cobrancaId)
        .order('rodada', { ascending: false }),
      supabase
        .from('cobranca_modelos')
        .select('id, tipo')
        .eq('ativo', true)
        .order('criado_em', { ascending: false }),
    ])

    const c = cobrancaQ.data
    if (!c) return { ok: false, code: 'not_found', message: 'Cobrança não encontrada.' }
    if (titulosQ.error) throw new MutationError(titulosQ.error.message, 'unknown')

    const config = lerCobrancaConfig(configQ.data ?? [])
    const anteriores = anterioresQ.data ?? []
    const maxRodada = anteriores.reduce((m, n) => Math.max(m, n.rodada), 0)
    const ultimaSaiu = anteriores.some((n) => n.rodada === maxRodada && !['rascunho', 'pronta'].includes(n.status))
    const rodada = opcoes.rodada ?? (maxRodada === 0 ? 1 : ultimaSaiu ? maxRodada + 1 : maxRodada)

    const ativos = ((titulosQ.data ?? []) as unknown as TituloParaMinuta[]).filter(
      (t) => !['quitado', 'retirado'].includes(t.situacao),
    )
    if (ativos.length === 0) {
      return { ok: false, code: 'invalid', message: 'Não há título em aberto nesta cobrança para notificar.' }
    }
    const porId = new Map(ativos.map((t) => [t.id, t]))

    const grupos = agruparNotificacoes(
      ativos.map((t) => ({
        id: t.id,
        sacado_cnpj: t.sacado_cnpj_snapshot,
        sacado_matriz_cnpj: t.titulos?.sacado_matriz_cnpj ?? c.sacado_matriz_cnpj,
        cedente_cnpj: t.cedente_cnpj_snapshot,
        cedente_matriz_cnpj: t.titulos?.cedente_matriz_cnpj ?? t.cedente_cnpj_snapshot,
      })),
      {
        escopo: c.escopo_notificacao === 'sacado_e_cedente' ? 'sacado_e_cedente' : 'sacado',
        notificarMatrizCedente: c.notificar_matriz_cedente,
      },
    )

    const parametros = parametrosDaCobranca(c, config)
    const hoje = hojeSaoPaulo()
    // A reiteração é "o valor atualizado NA DATA" (§5); a rodada 1 respeita a data-base
    // que a pessoa escolheu na criação.
    const dataBase = rodada > 1 ? hoje : (c.data_base ?? hoje)
    const tabela = await lerTabelaIndices(supabase, parametros.indice)

    const cadastro = await lerCadastro(
      supabase,
      grupos.map((g) => g.destinatario_cnpj),
    )

    /*
     * Endereço corrigido à mão numa rodada anterior não se perde na seguinte. O AR
     * devolvido é a razão nº 1 de alguém editar o endereço — e a reiteração sair para
     * o endereço velho da Receita repetiria exatamente a devolução.
     */
    const editados = new Map<string, { razao: string; endereco: EnderecoDestinatario }>()
    for (const n of anteriores) {
      const end = n.destinatario_endereco as EnderecoDestinatario | null
      if (end?.editado && !editados.has(n.destinatario_cnpj)) {
        editados.set(n.destinatario_cnpj, { razao: n.destinatario_razao_social, endereco: end })
      }
    }

    const modelos = modelosQ.data ?? []
    const prazoDias = config.cobranca.prazo_pagamento_dias
    const prazoExpira = config.cobranca.prazo_pagamento_uteis
      ? somarDiasUteis(hoje, prazoDias)
      : somarDiasCorridos(hoje, prazoDias)

    let totalMatriz: number | null = null
    const notificacoes: NotificacaoParaSalvar[] = grupos.map((g) => {
      const ts = g.titulo_ids.map((id) => porId.get(id)!)
      const resultado = atualizarDividaCobranca(
        ts.map((t) => ({
          id: t.id,
          valor_face: Number(t.valor_face_snapshot),
          vencimento: t.vencimento_snapshot,
          descricao: t.titulos?.numero ?? t.titulos?.externo_id ?? null,
          access_key: t.titulos?.nf_chave_acesso ?? null,
          antecipacao_id_externo: t.titulos?.antecipacao_id_externo ?? null,
        })),
        parametros,
        tabela,
        dataBase,
      )
      if (g.papel === 'sacado_matriz') totalMatriz = resultado.total

      const cad = cadastro.get(g.destinatario_cnpj)
      const editado = editados.get(g.destinatario_cnpj)
      const tipo = tipoDoModelo(g.papel, rodada)
      return {
        papel: g.papel,
        destinatario_cnpj: g.destinatario_cnpj,
        destinatario_empresa_id: cad?.empresa_id ?? null,
        destinatario_razao_social: editado?.razao ?? cad?.razao_social ?? g.destinatario_cnpj,
        destinatario_endereco: editado?.endereco ?? enderecoDoCadastro(cad),
        modelo_id: modelos.find((m) => m.tipo === tipo)?.id ?? null,
        cobranca_titulo_ids: g.titulo_ids,
        valor_total_atualizado: resultado.total,
        memoria_calculo: resultado,
        prazo_pagamento_dias: prazoDias,
        prazo_expira_em: prazoExpira,
      }
    })

    const salvas = await salvarNotificacoesCobranca(supabase, {
      cobranca_id: cobrancaId,
      rodada,
      notificacoes,
      ...(totalMatriz !== null ? { valor_atualizado: totalMatriz } : {}),
    })

    const docs = await gerarPdfs(
      supabase,
      salvas.map((n) => n.id),
    )

    revalidar(cobrancaId)
    return {
      ok: true,
      data: { rodada, notificacoes: salvas.length, valor_atualizado: totalMatriz, ...docs },
    }
  } catch (e) {
    return falhaDe(e)
  }
}

/** "Gerar PDF" / "Regerar PDF" de notificações já gravadas. */
export async function gerarPdfsNotificacoesAction(
  cobrancaId: string,
  notificacaoIds: string[],
): Promise<ActionResult<ResultadoDocumentos>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const docs = await gerarPdfs(supabase, notificacaoIds)
    revalidar(cobrancaId)
    return { ok: true, data: docs }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Endereço e razão social antes do envio. O RPC descarta o PDF (o documento é o que
 * foi impresso com o endereço antigo), então o PDF é regerado na mesma ação — sem isso
 * a notificação ficaria em rascunho e o botão de enviar sumiria sem explicação.
 */
export async function editarNotificacaoAction(
  input: unknown,
): Promise<ActionResult<{ notificacao: Tables<'cobranca_notificacoes'>; documentos: ResultadoDocumentos }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const n = await editarNotificacaoCobranca(supabase, input)
    const documentos = await gerarPdfs(supabase, [n.id])
    revalidar(n.cobranca_id)
    return { ok: true, data: { notificacao: n, documentos } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §4 Envio e entregas ────────────────────────────────────────────────────

export async function enviarNotificacaoAction(
  cobrancaId: string,
  input: unknown,
): Promise<ActionResult<Tables<'cobranca_notificacao_entregas'>[]>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await enviarNotificacaoCobranca(supabase, input)
    revalidar(cobrancaId)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

/** Correio com AR, cartório de TD e entrega pessoal — e a confirmação de qualquer entrega. */
export async function registrarEntregaAction(
  cobrancaId: string,
  input: unknown,
): Promise<ActionResult<Tables<'cobranca_notificacao_entregas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await registrarEntregaCobranca(supabase, input)
    revalidar(cobrancaId)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Títulos e contatos ─────────────────────────────────────────────────────

export async function quitarTituloAction(
  cobrancaId: string,
  input: unknown,
): Promise<ActionResult<Tables<'cobranca_titulos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await quitarTituloCobranca(supabase, input)
    revalidar(cobrancaId)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function retirarTituloAction(
  cobrancaId: string,
  cobrancaTituloId: string,
): Promise<ActionResult<Tables<'cobranca_titulos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await retirarTituloCobranca(supabase, { id: cobrancaTituloId })
    revalidar(cobrancaId)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function registrarInteracaoAction(input: unknown): Promise<ActionResult<Tables<'cobranca_interacoes'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await registrarInteracaoCobranca(supabase, input)
    revalidar(r.cobranca_id)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §9 Acordo ──────────────────────────────────────────────────────────────

/**
 * Salva o cenário escolhido no simulador (§9.2). A tela manda só o CENÁRIO (entrada,
 * parcelas, juros, sistema); o valor atualizado e o cronograma são refeitos aqui, com os
 * parâmetros GRAVADOS da cobrança e a tabela de índices do banco — é o número que vai
 * para a minuta de confissão, e não pode ser um total que o navegador ajustou.
 */
export async function salvarCenarioAcordoAction(input: {
  cobranca_id: string
  data_base: string
  cenario: Omit<SimulacaoParcelamentoInput, 'valor'>
  modelo_minuta_id?: string
}): Promise<ActionResult<Tables<'acordos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const [cobrancaQ, titulosQ, configQ] = await Promise.all([
      supabase.from('cobrancas').select('*').eq('id', input.cobranca_id).maybeSingle(),
      supabase
        .from('cobranca_titulos')
        .select('id, valor_face_snapshot, vencimento_snapshot, situacao, titulos(numero, externo_id, nf_chave_acesso)')
        .eq('cobranca_id', input.cobranca_id)
        .in('situacao', ['em_cobranca', 'acordado', 'protestado', 'sinistrado']),
      supabase.from('cobranca_config').select('chave, valor'),
    ])
    const c = cobrancaQ.data
    if (!c) return { ok: false, code: 'not_found', message: 'Cobrança não encontrada.' }
    const ts = (titulosQ.data ?? []) as unknown as (Pick<
      Tables<'cobranca_titulos'>,
      'id' | 'valor_face_snapshot' | 'vencimento_snapshot'
    > & { titulos: Pick<Tables<'titulos'>, 'numero' | 'externo_id' | 'nf_chave_acesso'> | null })[]
    if (ts.length === 0) return { ok: false, code: 'invalid', message: 'Não há título devido para acordar.' }

    const parametros = parametrosDaCobranca(c, lerCobrancaConfig(configQ.data ?? []))
    const tabela = await lerTabelaIndices(supabase, parametros.indice)
    const resultado = atualizarDividaCobranca(
      ts.map((t) => ({
        id: t.id,
        valor_face: Number(t.valor_face_snapshot),
        vencimento: t.vencimento_snapshot,
        descricao: t.titulos?.numero ?? t.titulos?.externo_id ?? null,
        access_key: t.titulos?.nf_chave_acesso ?? null,
      })),
      parametros,
      tabela,
      input.data_base || hojeSaoPaulo(),
    )
    const sim = simularParcelamento({ ...input.cenario, valor: resultado.total })

    const a = await salvarAcordo(supabase, {
      cobranca_id: input.cobranca_id,
      valor_atualizado: resultado.total,
      memoria_calculo: resultado,
      entrada: sim.entrada,
      qtd_parcelas: sim.qtd_parcelas,
      periodicidade: sim.periodicidade,
      juros_parcelamento_mes: sim.juros_mes,
      sistema: sim.sistema,
      primeira_parcela: input.cenario.primeira_parcela,
      valor_total_projetado: sim.valor_total_projetado,
      parcelas: sim.parcelas,
      ...(input.modelo_minuta_id ? { modelo_minuta_id: input.modelo_minuta_id } : {}),
    })
    revalidar(a.cobranca_id)
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function atualizarDadosMinutaAction(input: unknown): Promise<ActionResult<Tables<'acordos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await atualizarDadosMinuta(supabase, input)
    revalidar(a.cobranca_id)
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

/** O PDF da confissão (§9.3) é do worker: mesmo modelo, mesma stack, hash gravado. */
export async function gerarMinutaAcordoAction(
  cobrancaId: string,
  acordoId: string,
): Promise<ActionResult<{ gerado: boolean; erro: string | null }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await dispararDocumentosCobranca({ tipo: 'minuta', acordo_id: acordoId })
  if (!r.ok) return { ok: false, message: r.message, code: r.code }
  const { gerados, erros } = lerCorpoDocumentos(r.corpo)
  revalidar(cobrancaId)
  return { ok: true, data: { gerado: gerados > 0, erro: erros[0]?.mensagem ?? null } }
}

export async function anexarAcordoAssinadoAction(input: unknown): Promise<ActionResult<Tables<'acordos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await anexarAcordoAssinado(supabase, input)
    revalidar(a.cobranca_id)
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function cancelarAcordoAction(acordoId: string): Promise<ActionResult<Tables<'acordos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await cancelarAcordo(supabase, { acordo_id: acordoId })
    revalidar(a.cobranca_id)
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §8 Protesto ────────────────────────────────────────────────────────────

type TituloDaRemessa = Pick<
  Tables<'cobranca_titulos'>,
  'id' | 'valor_face_snapshot' | 'vencimento_snapshot' | 'sacado_cnpj_snapshot' | 'cedente_cnpj_snapshot'
> & {
  titulos: Pick<Tables<'titulos'>, 'numero' | 'externo_id' | 'nf_chave_acesso' | 'emissao' | 'sacado_nome' | 'cedente_nome'> | null
}

/**
 * Monta a planilha da remessa (CSV do portal do CRA, `core/cobranca/protesto.ts`) e a
 * grava na pasta de protestos da cobrança, com o client do usuário — a política do
 * bucket é a mesma para a tela e para aqui, e o RPC confere o prefixo do caminho.
 *
 * Um arquivo novo a cada geração (carimbo de tempo): o bucket não tem UPDATE, e a
 * remessa que foi ao portal é a que precisa continuar lá.
 */
async function montarArquivoRemessa(supabase: Supa, remessaId: string): Promise<Tables<'protesto_remessas'>> {
  const { data: remessa, error } = await supabase
    .from('protesto_remessas')
    .select('*, protesto_titulos(id, cobranca_titulo_id)')
    .eq('id', remessaId)
    .maybeSingle()
  if (error || !remessa) throw new MutationError('Remessa não encontrada.', 'not_found')
  if (!remessa.cobranca_id) throw new MutationError('Remessa sem cobrança.', 'invalid')

  const pts = (remessa.protesto_titulos ?? []) as { id: string; cobranca_titulo_id: string | null }[]
  const ctIds = pts.map((p) => p.cobranca_titulo_id).filter((x): x is string => Boolean(x))

  const [{ data: cts }, { data: cfg }] = await Promise.all([
    supabase
      .from('cobranca_titulos')
      .select(
        'id, valor_face_snapshot, vencimento_snapshot, sacado_cnpj_snapshot, cedente_cnpj_snapshot, titulos(numero, externo_id, nf_chave_acesso, emissao, sacado_nome, cedente_nome)',
      )
      .in('id', ctIds),
    supabase.from('cobranca_config').select('chave, valor'),
  ])
  const credor = lerCobrancaConfig(cfg ?? []).credor
  const porCt = new Map(((cts ?? []) as unknown as TituloDaRemessa[]).map((t) => [t.id, t]))
  const cadastro = await lerCadastro(
    supabase,
    [...porCt.values()].flatMap((t) => [t.sacado_cnpj_snapshot, t.cedente_cnpj_snapshot]),
  )

  const linhas: LinhaRemessaProtesto[] = []
  for (const p of pts) {
    const t = p.cobranca_titulo_id ? porCt.get(p.cobranca_titulo_id) : undefined
    if (!t) continue
    const dev = cadastro.get(t.sacado_cnpj_snapshot)
    const ced = cadastro.get(t.cedente_cnpj_snapshot)
    linhas.push({
      protesto_titulo_id: p.id,
      numero_titulo: t.titulos?.numero ?? t.titulos?.externo_id ?? t.id.slice(0, 8),
      // Duplicata mercantil por indicação quando há NF; o resto o cartório classifica.
      especie: t.titulos?.nf_chave_acesso ? 'DMI' : 'OUTRO',
      nf_chave_acesso: t.titulos?.nf_chave_acesso ?? null,
      emissao: t.titulos?.emissao ?? null,
      vencimento: t.vencimento_snapshot,
      valor: Number(t.valor_face_snapshot),
      saldo: Number(t.valor_face_snapshot),
      devedor_nome: dev?.razao_social ?? t.titulos?.sacado_nome ?? t.sacado_cnpj_snapshot,
      devedor_cnpj: t.sacado_cnpj_snapshot,
      devedor_endereco: [dev?.logradouro, dev?.numero, dev?.bairro].filter(Boolean).join(', '),
      devedor_cep: dev?.cep ?? null,
      devedor_municipio: dev?.municipio ?? null,
      devedor_uf: dev?.uf ?? remessa.uf,
      sacador_nome: credor.razao_social,
      sacador_cnpj: credor.cnpj,
      cedente_nome: ced?.razao_social ?? t.titulos?.cedente_nome ?? t.cedente_cnpj_snapshot,
      cedente_cnpj: t.cedente_cnpj_snapshot,
    })
  }
  if (linhas.length === 0) throw new MutationError('A remessa não tem títulos.', 'invalid')

  const csv = gerarRemessaProtestoCsv(linhas)
  const caminho = `${remessa.cobranca_id}/protestos/remessa-${remessa.tipo}-${Date.now()}.csv`
  const up = await supabase.storage
    .from(BUCKET)
    .upload(caminho, new Blob([csv], { type: 'text/csv' }), { upsert: false, contentType: 'text/csv' })
  if (up.error) throw new MutationError(`Não foi possível gravar a remessa: ${up.error.message}`, 'unknown')

  return anexarArquivoProtesto(supabase, { remessa_id: remessaId, arquivo_path: caminho })
}

export async function criarRemessaProtestoAction(input: {
  cobranca_id: string
  uf: string
  cra: string
  modo?: 'portal_manual' | 'api'
  cobranca_titulo_ids: string[]
}): Promise<ActionResult<{ remessa: Tables<'protesto_remessas'>; aviso: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const remessa = await criarRemessaProtesto(supabase, input)
    // A remessa existe mesmo se o arquivo falhar; a tela oferece "Gerar arquivo" de novo.
    try {
      const comArquivo = await montarArquivoRemessa(supabase, remessa.id)
      revalidar(input.cobranca_id)
      return { ok: true, data: { remessa: comArquivo, aviso: null } }
    } catch (e) {
      revalidar(input.cobranca_id)
      const f = falhaDe(e)
      return { ok: true, data: { remessa, aviso: `Remessa criada, mas o arquivo não saiu: ${f.message}` } }
    }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function gerarArquivoRemessaAction(
  cobrancaId: string,
  remessaId: string,
): Promise<ActionResult<Tables<'protesto_remessas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await montarArquivoRemessa(supabase, remessaId)
    revalidar(cobrancaId)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function marcarRemessaEnviadaAction(
  cobrancaId: string,
  input: unknown,
): Promise<ActionResult<Tables<'protesto_remessas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await marcarRemessaEnviada(supabase, input)
    revalidar(cobrancaId)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * O retorno do CRA: o navegador sobe o arquivo em `{cobranca}/protestos/retorno-…`, e
 * aqui ele é baixado com o client do usuário, lido pelo parser do core e aplicado pelo
 * RPC numa transação só. As linhas que o parser não casou voltam para a tela — nunca
 * são atribuídas "ao título mais parecido".
 */
export async function processarRetornoProtestoAction(input: {
  cobranca_id: string
  remessa_id: string
  retorno_path: string
}): Promise<ActionResult<{ aplicadas: number; ignoradas: { linha: number; motivo: string }[] }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    if (!input.retorno_path.startsWith(`${input.cobranca_id}/protestos/`)) {
      return { ok: false, code: 'forbidden', message: 'Arquivo fora da pasta de protestos desta cobrança.' }
    }
    const { data: pts, error } = await supabase
      .from('protesto_titulos')
      .select('id')
      .eq('remessa_id', input.remessa_id)
    if (error) throw new MutationError(error.message, 'unknown')

    const arq = await supabase.storage.from(BUCKET).download(input.retorno_path)
    if (arq.error || !arq.data) throw new MutationError('Não foi possível ler o arquivo de retorno.', 'unknown')
    const texto = await arq.data.text()

    const lido = lerRetornoProtesto(texto, new Set((pts ?? []).map((p) => p.id)))
    if (lido.linhas.length === 0) {
      // Guarda o arquivo na remessa mesmo assim: é o que o cartório mandou.
      await anexarArquivoProtesto(supabase, { remessa_id: input.remessa_id, retorno_path: input.retorno_path })
      revalidar(input.cobranca_id)
      return { ok: true, data: { aplicadas: 0, ignoradas: lido.ignoradas } }
    }

    await processarRetornoProtesto(supabase, {
      remessa_id: input.remessa_id,
      retorno_path: input.retorno_path,
      linhas: lido.linhas,
    })
    revalidar(input.cobranca_id)
    return { ok: true, data: { aplicadas: lido.linhas.length, ignoradas: lido.ignoradas } }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function atualizarTituloProtestoAction(
  cobrancaId: string,
  input: unknown,
): Promise<ActionResult<Tables<'protesto_titulos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await atualizarTituloProtesto(supabase, input)
    revalidar(cobrancaId)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Retirada depois da quitação (§8/§11). Com instrução, nasce uma remessa de
 * cancelamento/desistência em rascunho — e o arquivo dela sai junto, pronto para o
 * portal. "Não se aplica" só grava o motivo.
 */
export async function instrucaoCancelamentoAction(input: {
  cobranca_id: string
  protesto_titulo_ids: string[]
  tipo?: 'cancelamento' | 'desistencia'
  nao_aplicavel_motivo?: string
}): Promise<ActionResult<{ remessa: Tables<'protesto_remessas'> | null; aviso: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const remessa = await instrucaoCancelamentoProtesto(supabase, input)
    let aviso: string | null = null
    let final = remessa
    if (remessa) {
      try {
        final = await montarArquivoRemessa(supabase, remessa.id)
      } catch (e) {
        aviso = `Instrução criada, mas o arquivo não saiu: ${falhaDe(e).message}`
      }
    }
    revalidar(input.cobranca_id)
    return { ok: true, data: { remessa: final, aviso } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §10 Processo ───────────────────────────────────────────────────────────

export async function vincularProcessoAction(input: unknown): Promise<ActionResult<Tables<'cobrancas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await vincularProcessoCobranca(supabase, input)
    revalidar(c.id)
    if (c.processo_cnj) revalidatePath(`/juridico/${c.processo_cnj}`)
    revalidatePath('/juridico')
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function criarProcessoAction(input: unknown): Promise<ActionResult<Tables<'cobrancas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await criarProcessoCobranca(supabase, input)
    revalidar(c.id)
    revalidatePath('/juridico')
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §7 Sinistro a partir da cobrança ───────────────────────────────────────

export async function criarSinistroAction(input: unknown): Promise<ActionResult<Tables<'sinistros'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const s = await criarSinistro(supabase, input)
    if (s.cobranca_id) revalidar(s.cobranca_id)
    revalidatePath('/cobranca/sinistros')
    return { ok: true, data: s }
  } catch (e) {
    return falhaDe(e)
  }
}
