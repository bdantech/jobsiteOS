import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  classificarMovimentacao,
  consolidarCapa,
  identificarPartes,
  montarCronograma,
  normalizarEnvolvidos,
  normalizarTipoMovimentacao,
  ordemDaFase,
  type BenchmarkFases,
  type EscavadorMovimentacao,
  type EscavadorProcesso,
  type Fase,
  type RegraFase,
} from '../../../../../packages/core/src/juridico/index.js'
import type { Json } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'
import { recalcularScoresDeCnpjs } from '../credito/potencial.js'
import { notificarAdvogado } from './notificar.js'

/**
 * O caminho ÚNICO por onde um processo do Escavador vira linhas nossas.
 *
 * A descoberta, a sincronização e o callback de `novo_processo` chamam esta função —
 * três entradas, uma escrita. Duplicar a lógica em cada uma seria três lugares onde o
 * upsert de movimentação pode divergir, e a divergência apareceria como uma timeline
 * que muda conforme o caminho pelo qual o processo entrou.
 */

export interface ResultadoPersistencia {
  numero_cnj: string
  novo: boolean
  movimentacoes_novas: number
  relevantes: number
  fase_anterior: string | null
  fase_atual: string | null
  empresa_devedora_id: string | null
  /** CNPJ do devedor que não existe em `empresas` — foi para a fila de lookup. */
  devedor_sem_cadastro: string | null
}

/** `empresas.id` a partir de uma lista de CNPJs candidatos, na ordem dada. */
async function resolverEmpresa(cnpjs: readonly string[]): Promise<{ id: string | null; cnpj: string | null }> {
  if (cnpjs.length === 0) return { id: null, cnpj: null }
  const { data } = await supabaseAdmin.from('empresas').select('id, cnpj').in('cnpj', cnpjs as string[])
  // A ORDEM dos candidatos manda, não a que o Postgres devolveu: o primeiro CNPJ do
  // polo oposto é o executado principal, e os seguintes costumam ser avalistas e
  // coobrigados. Pendurar o processo no avalista mudaria a ficha errada.
  for (const cnpj of cnpjs) {
    const achado = (data ?? []).find((e) => e.cnpj === cnpj)
    if (achado) return { id: achado.id, cnpj }
  }
  return { id: null, cnpj: cnpjs[0] ?? null }
}

export async function persistirProcesso(
  bruto: EscavadorProcesso,
  contexto: {
    nossosCnpjs: readonly string[]
    regras: readonly RegraFase[]
    benchmark: BenchmarkFases
    movimentacoes?: readonly EscavadorMovimentacao[]
    /** `novo_processo` do callback: o evento e a notificação são outros (§9). */
    origem: 'descoberta' | 'sincronizacao' | 'callback'
  },
): Promise<ResultadoPersistencia | null> {
  const capa = consolidarCapa(bruto)
  if (!capa) {
    logger.warn('Processo do Escavador sem numero_cnj; descartado.')
    return null
  }

  const envolvidos = normalizarEnvolvidos(bruto.fontes)
  const partes = identificarPartes(envolvidos, contexto.nossosCnpjs)
  const devedor = await resolverEmpresa(partes.cnpjs_devedores)

  const { data: antes } = await supabaseAdmin
    .from('processos')
    .select('numero_cnj, fase_atual, empresa_devedora_id')
    .eq('numero_cnj', capa.numero_cnj)
    .maybeSingle()
  const novo = !antes

  /*
   * UPSERT que NÃO toca a gestão. `situacao_interna`, `advogado_id`, `observacoes` e
   * `vinculo_cobranca_id` ficam de fora da lista de colunas de propósito: são decisão
   * humana, e uma sincronização que as sobrescrevesse devolveria para "em andamento"
   * um processo que alguém acabou de marcar como acordo.
   *
   * `empresa_devedora_id` só é escrito quando ACHAMOS a empresa: um null vindo daqui
   * apagaria uma vinculação feita à mão na fila de vinculação manual.
   */
  const { error: erroUpsert } = await supabaseAdmin.from('processos').upsert(
    {
      numero_cnj: capa.numero_cnj,
      ...(devedor.id ? { empresa_devedora_id: devedor.id } : {}),
      cnpj_devedor: devedor.cnpj,
      nosso_cnpj: partes.nosso_cnpj,
      polo_nosso: partes.polo_nosso,
      titulo_polo_ativo: capa.titulo_polo_ativo,
      titulo_polo_passivo: capa.titulo_polo_passivo,
      classe: capa.classe,
      assunto: capa.assunto,
      area: capa.area,
      orgao_julgador: capa.orgao_julgador,
      comarca: capa.comarca,
      uf: capa.uf,
      tribunal_sigla: capa.tribunal_sigla,
      tribunal_nome: capa.tribunal_nome,
      grau: capa.grau,
      sistema: capa.sistema,
      valor_causa: capa.valor_causa,
      data_distribuicao: capa.data_distribuicao,
      data_inicio: capa.data_inicio,
      data_arquivamento: capa.data_arquivamento,
      segredo_justica: capa.segredo_justica,
      arquivado: capa.arquivado,
      fisico: capa.fisico,
      status_predito: capa.status_predito,
      url_tribunal: capa.url_tribunal,
      data_ultima_movimentacao: capa.data_ultima_movimentacao,
      qtd_movimentacoes: capa.qtd_movimentacoes,
      data_ultima_verificacao: capa.data_ultima_verificacao,
      ultima_sincronizacao: new Date().toISOString(),
      raw: bruto as unknown as Json,
    },
    { onConflict: 'numero_cnj' },
  )
  if (erroUpsert) throw new Error(`Falha ao gravar processo ${capa.numero_cnj}: ${erroUpsert.message}`)

  // ── Envolvidos ──
  if (envolvidos.length > 0) {
    const { error } = await supabaseAdmin.from('processo_envolvidos').upsert(
      envolvidos.map((e) => ({
        numero_cnj: capa.numero_cnj,
        nome: e.nome,
        tipo_pessoa: e.tipo_pessoa,
        cpf_cnpj: e.cpf_cnpj,
        tipo: e.tipo,
        tipo_normalizado: e.tipo_normalizado,
        polo: e.polo,
        advogados: e.advogados as unknown as Json,
        atualizado_em: new Date().toISOString(),
      })),
      { onConflict: 'numero_cnj,nome,polo' },
    )
    if (error) logger.error({ cnj: capa.numero_cnj, erro: error.message }, 'Falha ao gravar envolvidos.')
  }

  // ── Movimentações (idempotente pelo id do Escavador) ──
  let movimentacoesNovas = 0
  let relevantes = 0

  if (contexto.movimentacoes?.length) {
    const { data: existentes } = await supabaseAdmin
      .from('processo_movimentacoes')
      .select('id')
      .eq('numero_cnj', capa.numero_cnj)
    const jaTemos = new Set((existentes ?? []).map((m) => Number(m.id)))

    const linhas = contexto.movimentacoes
      .filter((m) => typeof m.id === 'number' && m.conteudo)
      .map((m) => {
        const c = classificarMovimentacao(m.conteudo ?? '', contexto.regras)
        if (c.relevante && !jaTemos.has(Number(m.id))) relevantes++
        if (!jaTemos.has(Number(m.id))) movimentacoesNovas++
        return {
          id: Number(m.id),
          numero_cnj: capa.numero_cnj,
          data: (m.data ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10),
          tipo: normalizarTipoMovimentacao(m.tipo),
          conteudo: m.conteudo ?? '',
          fonte_nome: m.fonte?.nome ?? null,
          fonte_sigla: m.fonte?.sigla ?? null,
          grau: m.fonte?.grau ?? null,
          fase_detectada: c.fase,
          relevante: c.relevante,
          termo_detectado: c.termo,
        }
      })

    if (linhas.length > 0) {
      const { error } = await supabaseAdmin
        .from('processo_movimentacoes')
        .upsert(linhas, { onConflict: 'id' })
      if (error) throw new Error(`Falha ao gravar movimentações de ${capa.numero_cnj}: ${error.message}`)
    }
  }

  // ── Fase e cronograma ──
  const { data: todas } = await supabaseAdmin
    .from('processo_movimentacoes')
    .select('data, fase_detectada')
    .eq('numero_cnj', capa.numero_cnj)
    .not('fase_detectada', 'is', null)
    .order('data')

  const cronograma = montarCronograma(todas ?? [], contexto.benchmark)
  const faseAnterior = antes?.fase_atual ?? null

  if (cronograma.fase_atual && cronograma.fase_atual !== faseAnterior) {
    await supabaseAdmin
      .from('processos')
      .update({ fase_atual: cronograma.fase_atual, fase_desde: cronograma.fase_desde })
      .eq('numero_cnj', capa.numero_cnj)
  }

  // ── Eventos ──
  const empresaId = devedor.id ?? antes?.empresa_devedora_id ?? null

  if (novo) {
    await emitirEvento(
      empresaId,
      contexto.origem === 'callback' ? EVENTO_TIPOS.PROCESSO_NOVO_DETECTADO : EVENTO_TIPOS.PROCESSO_IMPORTADO,
      {
        titulo: contexto.origem === 'callback' ? 'Novo processo detectado' : 'Processo judicial importado',
        resumo:
          `${capa.classe ?? 'Processo'} ${capa.numero_cnj}` +
          (capa.valor_causa ? ` · causa de R$ ${Math.round(capa.valor_causa).toLocaleString('pt-BR')}` : ''),
        url: `/juridico/${capa.numero_cnj}`,
        numero_cnj: capa.numero_cnj,
        cnpj_devedor: devedor.cnpj,
      },
    )
  }

  /*
   * A mudança de fase é evento SEMPRE que muda — inclusive na importação inicial de um
   * processo que já chega na penhora. Só a AVANÇADA importa, e `montarCronograma` já
   * garante que a fase não retrocede, então isto nunca dispara por vaivém de juntada.
   */
  if (cronograma.fase_atual && cronograma.fase_atual !== faseAnterior && !novo) {
    await emitirEvento(empresaId, EVENTO_TIPOS.PROCESSO_FASE_ALTERADA, {
      titulo: 'Processo mudou de fase',
      resumo: `${capa.numero_cnj}: ${faseAnterior ?? 'sem fase'} → ${cronograma.fase_atual}.`,
      url: `/juridico/${capa.numero_cnj}`,
      numero_cnj: capa.numero_cnj,
      de: faseAnterior,
      para: cronograma.fase_atual,
    })
  }

  /*
   * Movimentação relevante notifica O ADVOGADO DAQUELE processo, com push — não um
   * perfil inteiro. Citação e penhora mudam o que ele pode fazer amanhã de manhã; as
   * outras duzentas movimentações do mês não são dele.
   *
   * Só em processo que já existia: na importação inicial, um processo com dez anos de
   * histórico dispararia dez notificações de fatos antigos.
   */
  if (relevantes > 0 && !novo) {
    await notificarAdvogado(capa.numero_cnj, {
      titulo: 'Movimentação relevante',
      corpo: `${capa.numero_cnj}: ${relevantes} movimentação(ões) que mudam o andamento.`,
      url: `/juridico/${capa.numero_cnj}`,
    })
    await emitirEvento(empresaId, EVENTO_TIPOS.PROCESSO_MOVIMENTACAO_RELEVANTE, {
      titulo: 'Movimentação relevante',
      resumo: `${relevantes} movimentação(ões) relevante(s) em ${capa.numero_cnj}.`,
      url: `/juridico/${capa.numero_cnj}`,
      numero_cnj: capa.numero_cnj,
      quantidade: relevantes,
    })
  }

  /*
   * Devedor sem cadastro vai para `cnpj_lookup_fila` — a MESMA fila da Antecipação.
   * Uma fila própria do Jurídico consultaria as mesmas APIs gratuitas pelo mesmo CNPJ
   * que a outra já está resolvendo, e as duas se atropelariam no rate limit.
   */
  let semCadastro: string | null = null
  if (!devedor.id && devedor.cnpj) {
    semCadastro = devedor.cnpj
    const { error } = await supabaseAdmin
      .from('cnpj_lookup_fila')
      .upsert({ cnpj: devedor.cnpj, motivo: 'sacado_nf' }, { onConflict: 'cnpj', ignoreDuplicates: true })
    if (error) logger.error({ cnpj: devedor.cnpj, erro: error.message }, 'Falha ao enfileirar lookup.')
  }

  /*
   * O SCORE É REPONTUADO NA HORA quando o processo é novo (08 §9).
   *
   * O trigger da 0143 já virou `empresas.tem_processo_nosso_ativo`, mas o score é
   * CACHE em `empresas.score_faixa`, e quem lê a chance de concessão lê o cache. Sem
   * repontuar, uma empresa contra a qual acabamos de ajuizar continuaria com faixa
   * "alta" até a varredura mensal — e é exatamente na semana da ação que alguém pede
   * limite para ela.
   *
   * Dirigido a UM cnpj, nunca a base: repontuar oito mil empresas porque uma foi
   * processada é caro o bastante para alguém desligar o gatilho.
   *
   * Best-effort: falta de scorecard ativo ou erro de rede não pode derrubar uma
   * sincronização que já gravou as movimentações.
   */
  if (novo && devedor.cnpj) {
    try {
      await recalcularScoresDeCnpjs([devedor.cnpj])
    } catch (e) {
      logger.error({ cnpj: devedor.cnpj, erro: String(e) }, 'Falha ao repontuar score após novo processo.')
    }
  }

  return {
    numero_cnj: capa.numero_cnj,
    novo,
    movimentacoes_novas: movimentacoesNovas,
    relevantes,
    fase_anterior: faseAnterior,
    fase_atual: cronograma.fase_atual,
    empresa_devedora_id: empresaId,
    devedor_sem_cadastro: semCadastro,
  }
}

/** A fase mais avançada de uma lista já classificada. Usada pelo job de reclassificação. */
export function faseMaisAvancada(fases: readonly (string | null)[]): Fase | null {
  let melhor: Fase | null = null
  for (const f of fases) {
    if (!f) continue
    if (melhor === null || ordemDaFase(f) > ordemDaFase(melhor)) melhor = f as Fase
  }
  return melhor
}
