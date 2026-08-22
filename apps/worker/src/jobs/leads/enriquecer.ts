import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { contatosEmpresa } from '../radar/contatos.js'
import { dominioEmpresa } from '../radar/dominios.js'
import { estimarFaturamentoJob } from '../radar/estimador.js'
import { funcionariosEmpresa } from '../radar/funcionarios.js'
import { recalcularScoresDeCnpjs } from '../credito/potencial.js'

/**
 * O enriquecimento de um lead que acabou de chegar (04i).
 *
 * ─── O BURACO QUE ISTO FECHA ────────────────────────────────────────────────
 * O formulário criava a empresa, enfileirava o cadastral da Receita e parava. Domínio,
 * funcionários, faturamento e score só aconteciam por botão na ficha ou pelo lote mensal
 * — ou seja, um lead que chegava no dia 8 ficava quase trinta dias sem faturamento
 * estimado e sem score. E é o score que alimenta o `valor_esperado_mensal`, que é a régua
 * pela qual o SDR decide para quem ligar primeiro: o lead novo entrava na fila sem a nota
 * que define a ordem.
 *
 * ─── A ORDEM NÃO É PREFERÊNCIA, É DEPENDÊNCIA ───────────────────────────────
 *   domínio      → é o que o Apollo usa para achar contato.
 *   funcionários → é o SINAL principal do estimador de faturamento.
 *   faturamento  → é a base do limite potencial e entra no score.
 *   score        → é o último, porque lê tudo que veio antes.
 * Inverter qualquer par produz um resultado pior em silêncio: o score sai de uma base
 * mais pobre e ninguém nota, porque um score sempre sai.
 *
 * ─── O QUE É GRÁTIS RODA SEMPRE; O QUE CUSTA ESPERA O TOGGLE ────────────────
 * Domínio (etapas de e-mail, heurística e validação DNS), faturamento e score não têm
 * custo por CNPJ: rodam em todo lead. Funcionários, contatos Apollo e a busca de domínio
 * via Claude são pagos por consulta, e só rodam com `formularios.enriquecimento_pago`
 * ligado — que até agora era um botão na tela sem nada do outro lado.
 *
 * "Em todo lead que chega" é a pior frase possível ao lado de uma chamada paga: lead de
 * teste, concorrente curioso e spam que passou pelo filtro também chegam.
 */

/** Quantas submissões por corrida. Cada uma faz várias chamadas de rede em sequência. */
const LOTE = 25

interface Pendente {
  id: string
  cnpj: string
  formulario_id: string | null
}

export interface ResultadoEnriquecimento {
  processadas: number
  dominios: number
  funcionarios: number
  contatos: number
  faturamentos: number
  scores: number
  falhas: number
}

/**
 * Uma etapa que pode falhar sem derrubar as outras.
 *
 * Enriquecimento é acessório: o lead já está na base, já foi roteado, já tem SDR. Deixar
 * de calcular o score porque o Apollo estava fora do ar seria perder a parte gratuita por
 * causa da paga.
 */
async function tentar<T>(nome: string, submissaoId: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    logger.warn(
      { submissao: submissaoId, etapa: nome, erro: e instanceof Error ? e.message : String(e) },
      'Etapa do enriquecimento do lead falhou; as outras seguem.',
    )
    return null
  }
}

export async function enriquecerLeads(): Promise<ResultadoEnriquecimento> {
  const acc: ResultadoEnriquecimento = {
    processadas: 0,
    dominios: 0,
    funcionarios: 0,
    contatos: 0,
    faturamentos: 0,
    scores: 0,
    falhas: 0,
  }

  // O mesmo recorte do índice `formulario_submissoes_pendentes_idx`, criado na 0120 para
  // exatamente esta varredura. Spam e erro ficam de fora: não há lead para enriquecer.
  const { data: pendentes, error } = await supabaseAdmin
    .from('formulario_submissoes')
    .select('id, cnpj, formulario_id')
    .in('status', ['recebida', 'processada'])
    .is('processada_em', null)
    .order('criada_em', { ascending: true })
    .limit(LOTE)
  if (error) throw new Error(error.message)
  if (!pendentes || pendentes.length === 0) return acc

  // Uma leitura só para saber quais formulários pagam. São poucos; uma consulta por
  // submissão seria N consultas para responder uma pergunta que muda uma vez por mês.
  const ids = [...new Set(pendentes.map((s) => s.formulario_id).filter(Boolean))] as string[]
  const { data: forms } = await supabaseAdmin
    .from('formularios')
    .select('id, enriquecimento_pago')
    .in('id', ids)
  const pago = new Map((forms ?? []).map((f) => [f.id, f.enriquecimento_pago]))

  const cnpjsParaEstimar: string[] = []

  for (const s of pendentes as unknown as Pendente[]) {
    const podePagar = s.formulario_id ? (pago.get(s.formulario_id) ?? false) : false

    const { data: empresa } = await supabaseAdmin
      .from('empresas')
      .select('id, dominio, funcionarios')
      .eq('cnpj', s.cnpj)
      .maybeSingle()

    if (!empresa) {
      // Sem empresa não há o que enriquecer. Marca como processada mesmo assim: deixá-la
      // pendente faria a varredura tentar de novo para sempre.
      await marcar(s.id)
      acc.falhas++
      continue
    }

    // ── Domínio ────────────────────────────────────────────────────────────
    // O e-mail que a pessoa digitou já virou contato no `app_processar_submissao`, e a
    // etapa 2 do resolvedor lê justamente os e-mails dos contatos da empresa. Provedor
    // genérico é descartado lá dentro, e o domínio ainda passa por validação de DNS
    // contra o CNPJ — gmail.com nunca vira o domínio de ninguém.
    if (!empresa.dominio) {
      const d = await tentar('dominio', s.id, () =>
        dominioEmpresa(empresa.id, { incluirClaude: podePagar }),
      )
      if (d?.dominio) acc.dominios++
    }

    // ── Funcionários (PAGO) ────────────────────────────────────────────────
    // Antes do faturamento porque é o sinal principal do estimador: sem ele, só sobra o
    // Simples como pista, e boa parte dos leads não é do Simples.
    if (podePagar && empresa.funcionarios === null) {
      const f = await tentar('funcionarios', s.id, () => funcionariosEmpresa(empresa.id))
      if (f?.valor !== null && f?.valor !== undefined) acc.funcionarios++
    }

    // ── Contatos Apollo (PAGO) ─────────────────────────────────────────────
    // Depois do domínio, que é a chave de busca do Apollo. Sem domínio ele não tem por
    // onde começar, e a consulta sairia paga e vazia.
    if (podePagar) {
      const { data: comDominio } = await supabaseAdmin
        .from('empresas')
        .select('dominio')
        .eq('id', empresa.id)
        .maybeSingle()
      if (comDominio?.dominio) {
        const c = await tentar('contatos', s.id, () => contatosEmpresa({ empresaId: empresa.id }))
        if (c) acc.contatos++
      }
    }

    cnpjsParaEstimar.push(s.cnpj)
    await marcar(s.id)
    acc.processadas++
  }

  // ── Faturamento e score, em bloco ────────────────────────────────────────
  // Os dois são baratos e trabalham sobre conjuntos: rodá-los uma vez por lead seria
  // reabrir a mesma calibração e o mesmo scorecard N vezes para o mesmo resultado.
  if (cnpjsParaEstimar.length > 0) {
    const est = await tentar('faturamento', 'lote', () =>
      estimarFaturamentoJob({ cnpjs: cnpjsParaEstimar }),
    )
    acc.faturamentos = est?.gravadas ?? 0

    const sc = await tentar('score', 'lote', () => recalcularScoresDeCnpjs(cnpjsParaEstimar))
    acc.scores = (sc as { gravados?: number } | null)?.gravados ?? 0
  }

  logger.info(acc, 'Enriquecimento de leads concluído.')
  return acc
}

async function marcar(submissaoId: string): Promise<void> {
  await supabaseAdmin
    .from('formulario_submissoes')
    .update({ processada_em: new Date().toISOString() } as never)
    .eq('id', submissaoId)
}

/**
 * O enriquecimento de UMA submissão, chamado logo depois que ela entra.
 *
 * A varredura acima existe como rede de segurança (deploy no meio do caminho, worker
 * fora do ar); esta é o caminho normal, para o lead chegar ao SDR já com domínio e score
 * em vez de aparecer cru e completar-se meia hora depois.
 */
export async function enriquecerLeadAgora(): Promise<ResultadoEnriquecimento> {
  // Sem evento próprio: cada enriquecimento já emite o seu (dominio.resolvido,
  // contatos.enriquecidos, funcionarios.atualizado, score.recalculado). Um
  // "lead.enriquecido" por cima seria a mesma notícia contada duas vezes na timeline.
  return enriquecerLeads()
}
