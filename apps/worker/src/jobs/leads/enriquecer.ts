import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { contatosEmpresa } from '../radar/contatos.js'
import { dominioEmpresa } from '../radar/dominios.js'
import { estimarFaturamentoJob } from '../radar/estimador.js'
import { funcionariosEmpresa } from '../radar/funcionarios.js'
import { estimarPotencialJob, recalcularScoresDeCnpjs } from '../credito/potencial.js'
import { lookupCadastral } from '../antecipacao/lookup-cadastral.js'

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

/** O que cada etapa fez, gravado na submissão. Ver `enriquecimento_resultado` (0124). */
type Etapa =
  | 'cadastral'
  | 'dominio'
  | 'funcionarios'
  | 'contatos'
  | 'faturamento'
  | 'score'
  | 'limite'
type Desfecho = { ok: boolean; detalhe: string }
type Diario = Partial<Record<Etapa, Desfecho>>

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
async function tentar<T>(
  nome: Etapa,
  diario: Diario,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    // O log do container é ótimo para quem tem acesso a ele. O diário é para quem abre a
    // tela e pergunta "por que este lead não enriqueceu?" — que é a pergunta que
    // realmente se faz, e a que ficava sem resposta.
    diario[nome] = { ok: false, detalhe: erro }
    logger.warn({ etapa: nome, erro }, 'Etapa do enriquecimento do lead falhou; as outras seguem.')
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
  const porSubmissao = new Map<string, Diario>()

  for (const s of pendentes as unknown as Pendente[]) {
    const podePagar = s.formulario_id ? (pago.get(s.formulario_id) ?? false) : false
    const diario: Diario = {}

    const { data: empresa } = await supabaseAdmin
      .from('empresas')
      .select('id, dominio, funcionarios')
      .eq('cnpj', s.cnpj)
      .maybeSingle()

    if (!empresa) {
      // Sem empresa não há o que enriquecer. Marca como processada mesmo assim: deixá-la
      // pendente faria a varredura tentar de novo para sempre.
      await marcar(s.id, { cadastral: { ok: false, detalhe: 'Nenhuma empresa com este CNPJ.' } })
      acc.falhas++
      continue
    }

    // ── Cadastral: a base de tudo ──────────────────────────────────────────
    // O `app_processar_submissao` só enfileira o lookup quando a empresa é NOVA. Um CNPJ
    // que já existia por outra via (importação de lista, por exemplo) podia estar fora de
    // `mercado_universo` — e sem cadastro não há CNAE, não há Simples, não há situação,
    // não há idade. O estimador exige ao menos um sinal e não encontra nenhum; o
    // scorecard não consegue avaliar metade dos fatores e devolve `dados_insuficientes`.
    //
    // Foi exatamente o que aconteceu com o primeiro lead real (22/08/2026): domínio
    // resolvido, faturamento vazio, score vazio — e a causa estava dois passos antes.
    const { data: noUniverso } = await supabaseAdmin
      .from('mercado_universo')
      .select('cnpj')
      .eq('cnpj', s.cnpj)
      .maybeSingle()

    if (!noUniverso) {
      await supabaseAdmin
        .from('cnpj_lookup_fila')
        .upsert({ cnpj: s.cnpj, motivo: 'manual' } as never, { onConflict: 'cnpj', ignoreDuplicates: true })
      // Drena aqui mesmo, com orçamento curto: o resto da cadeia depende disto, e deixar
      // para o job diário devolveria o lead ao problema que este job existe para resolver.
      const r = await tentar('cadastral', diario, () => lookupCadastral({ orcamentoMs: 20_000 }))
      diario.cadastral ??= {
        ok: !!r,
        detalhe: r ? 'Cadastro da Receita resolvido pela fila.' : 'Fila drenada sem resultado.',
      }
    } else {
      diario.cadastral = { ok: true, detalhe: 'Já estava em mercado_universo.' }
    }

    // ── Domínio ────────────────────────────────────────────────────────────
    // O e-mail que a pessoa digitou já virou contato no `app_processar_submissao`, e a
    // etapa 2 do resolvedor lê justamente os e-mails dos contatos da empresa. Provedor
    // genérico é descartado lá dentro, e o domínio ainda passa por validação de DNS
    // contra o CNPJ — gmail.com nunca vira o domínio de ninguém.
    if (!empresa.dominio) {
      const d = await tentar('dominio', diario, () =>
        dominioEmpresa(empresa.id, { incluirClaude: podePagar }),
      )
      if (d?.dominio) acc.dominios++
      diario.dominio ??= {
        ok: !!d?.dominio,
        detalhe: d?.dominio ? `${d.dominio} (via ${d.origem})` : (d?.motivo ?? 'não encontrado'),
      }
    } else {
      diario.dominio = { ok: true, detalhe: `${empresa.dominio} (já tinha)` }
    }

    // ── Funcionários (PAGO) ────────────────────────────────────────────────
    // Antes do faturamento porque é o sinal principal do estimador: sem ele, só sobra o
    // Simples como pista, e boa parte dos leads não é do Simples.
    if (!podePagar) {
      diario.funcionarios = { ok: false, detalhe: 'Enriquecimento pago desligado neste formulário.' }
    } else if (empresa.funcionarios !== null) {
      diario.funcionarios = { ok: true, detalhe: `${empresa.funcionarios} (já tinha)` }
    } else {
      const f = await tentar('funcionarios', diario, () => funcionariosEmpresa(empresa.id))
      if (f?.valor !== null && f?.valor !== undefined) acc.funcionarios++
      diario.funcionarios ??= {
        ok: f?.valor != null,
        detalhe: f?.valor != null ? String(f.valor) : (f?.motivo ?? 'sem dados'),
      }
    }

    // ── Contatos Apollo (PAGO) ─────────────────────────────────────────────
    // Depois do domínio, que é a chave de busca do Apollo. Sem domínio ele não tem por
    // onde começar, e a consulta sairia paga e vazia.
    if (!podePagar) {
      diario.contatos = { ok: false, detalhe: 'Enriquecimento pago desligado neste formulário.' }
    } else {
      const { data: comDominio } = await supabaseAdmin
        .from('empresas')
        .select('dominio')
        .eq('id', empresa.id)
        .maybeSingle()
      if (!comDominio?.dominio) {
        diario.contatos = { ok: false, detalhe: 'Sem domínio: o Apollo não teria por onde buscar.' }
      } else {
        const c = await tentar('contatos', diario, () => contatosEmpresa({ empresaId: empresa.id }))
        if (c) acc.contatos++
        diario.contatos ??= { ok: !!c, detalhe: c ? `${c.processados} contato(s)` : 'sem dados' }
      }
    }

    cnpjsParaEstimar.push(s.cnpj)
    porSubmissao.set(s.id, diario)
    acc.processadas++
  }

  // ── Faturamento e score, em bloco ────────────────────────────────────────
  // Os dois são baratos e trabalham sobre conjuntos: rodá-los uma vez por lead seria
  // reabrir a mesma calibração e o mesmo scorecard N vezes para o mesmo resultado.
  if (cnpjsParaEstimar.length > 0) {
    const comum: Diario = {}
    const est = await tentar('faturamento', comum, () =>
      estimarFaturamentoJob({ cnpjs: cnpjsParaEstimar }),
    )
    acc.faturamentos = est?.gravadas ?? 0
    comum.faturamento ??= {
      ok: (est?.gravadas ?? 0) > 0,
      // O estimador exige ao menos um sinal (funcionários, ERP ou Simples). Sem nenhum,
      // ele não estima — e dizer isso é mais útil que um silêncio que parece bug.
      detalhe: est
        ? `${est.gravadas} gravada(s) de ${est.avaliadas} avaliada(s)${
            est.avaliadas === 0 ? ' — nenhum sinal (funcionários, ERP ou Simples)' : ''
          }`
        : 'não rodou',
    }

    const sc = await tentar('score', comum, () => recalcularScoresDeCnpjs(cnpjsParaEstimar))
    acc.scores = (sc as { gravados?: number } | null)?.gravados ?? 0
    comum.score ??= { ok: !!sc, detalhe: sc ? 'recalculado' : 'não rodou' }

    // O limite é a última peça, e é cache de uma conta sobre faturamento e chance — os
    // dois acabaram de mudar. Sem isto, o lead entra na fila com um limite derivado de um
    // faturamento que não é mais o dele.
    const pot = await tentar('limite', comum, () =>
      estimarPotencialJob({ cnpjs: cnpjsParaEstimar }),
    )
    comum.limite ??= {
      ok: !!pot?.com_limite,
      detalhe: pot?.com_limite
        ? `${pot.com_limite} com limite`
        : (pot?.sem_faturamento ? 'sem faturamento' : 'sem calibração'),
    }

    // As duas últimas etapas rodam em bloco, então o desfecho delas é o mesmo para todas
    // as submissões da corrida — cada uma recebe a sua cópia.
    for (const [id, diario] of porSubmissao) {
      await marcar(id, { ...diario, ...comum })
    }
  }

  logger.info(acc, 'Enriquecimento de leads concluído.')
  return acc
}

async function marcar(submissaoId: string, resultado: Diario): Promise<void> {
  await supabaseAdmin
    .from('formulario_submissoes')
    .update({
      processada_em: new Date().toISOString(),
      enriquecimento_resultado: resultado as never,
    } as never)
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
