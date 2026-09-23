import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { lerTtl } from '../../radar/config.js'
import { contatosEmpresa } from '../radar/contatos.js'
import { dominioEmpresa } from '../radar/dominios.js'

/**
 * Os contatos do Apollo chegam JUNTO com o lead distribuído (04g §4).
 *
 * ─── O QUE ISTO ELIMINA ─────────────────────────────────────────────────────
 * O SDR recebia a empresa na segunda de manhã e, antes de conseguir falar com
 * alguém, tinha de abrir a ficha e clicar em "buscar contatos" — uma vez por
 * lead, toda semana. O trabalho era mecânico e sempre o mesmo, e enquanto ele
 * não acontecia o lead era um CNPJ sem ninguém para ligar. O SLA, porém, já
 * estava correndo desde a distribuição.
 *
 * ─── POR QUE REUSA O CAMINHO DO LEAD DE FORMULÁRIO ──────────────────────────
 * `dominioEmpresa` e `contatosEmpresa` são os mesmos que o 04i chama quando um
 * lead entra pelo site, e passam pelo LOTE — que é quem registra custo, respeita
 * o teto mensal e grava `enriquecimentos`. Um atalho que falasse com o Apollo
 * direto gastaria crédito sem aparecer em nenhuma dessas contas, e o primeiro
 * sinal seria a fatura.
 *
 * ─── A ORDEM É DEPENDÊNCIA, NÃO PREFERÊNCIA ─────────────────────────────────
 * O Apollo busca por DOMÍNIO. Sem domínio a consulta sairia paga e vazia — por
 * isso o domínio vem antes, e quem continuar sem ele é pulado em vez de tentado.
 * Hoje 63% das empresas distribuídas têm domínio; a cascata gratuita roda para o
 * resto e recupera o que der.
 *
 * ─── A BUSCA PAGA DO CLAUDE FICA DE FORA ────────────────────────────────────
 * `incluirClaude: false`, pelo mesmo motivo que o 04i o desliga: ela custa por
 * empresa e roda em TODA empresa distribuída. As etapas gratuitas da cascata
 * (e-mail de contato, heurística, validação de DNS) não custam nada e resolvem
 * boa parte. Ligar a paga aqui é uma decisão de orçamento, não de código.
 *
 * ─── POR QUE NÃO PRECISA DE COLUNA DE CONTROLE ──────────────────────────────
 * O que diz "esta empresa já foi tentada" é o TTL de contatos em
 * `enriquecimentos`, que já existe e é a mesma régua que o lote usa para não
 * cobrar duas vezes pelo mesmo domínio. Ele entra no SQL abaixo, então uma
 * segunda passada não abre lote nenhum para quem já foi tentado — nem para os
 * 42% de domínios que o Apollo consulta e devolve vazio, que seriam justamente
 * os que uma varredura ingênua reprocessaria para sempre.
 *
 * Isso é o que torna esta função segura de chamar mais de uma vez: ela roda ao
 * fim da distribuição e de novo como rede de segurança, para o caso de o worker
 * reiniciar no meio da corrida de segunda.
 */

export interface ResultadoEnriquecerDistribuidos {
  candidatos: number
  dominios_resolvidos: number
  com_contatos: number
  sem_dominio: number
  falhas: number
}

/** Quantas empresas por corrida. Cada uma faz várias chamadas de rede em sequência. */
const LOTE = 40

interface Candidato {
  empresa_id: string
  cnpj: string
  dominio: string | null
  razao_social: string | null
}

export async function enriquecerLeadsDistribuidos(
  opts: { janelaDias?: number; limite?: number } = {},
): Promise<ResultadoEnriquecerDistribuidos> {
  const acc: ResultadoEnriquecerDistribuidos = {
    candidatos: 0,
    dominios_resolvidos: 0,
    com_contatos: 0,
    sem_dominio: 0,
    falhas: 0,
  }

  const ttl = await lerTtl()
  const janela = opts.janelaDias ?? 7
  const limite = opts.limite ?? LOTE

  /*
   * O lead tem de estar VIVO e ainda por trabalhar.
   *
   * `a_contatar` e não qualquer estágio: um lead que o SDR já moveu adiante é um
   * lead em que ele já achou com quem falar, e pagar o Apollo depois disso é
   * pagar por uma resposta que a pessoa já tem.
   *
   * O `not exists` é o TTL de contatos escrito em SQL — a mesma régua do lote,
   * aplicada antes de abrir lote nenhum. Sem ele, cada corrida abriria 40 lotes
   * para descobrir 40 vezes que não há nada a fazer.
   */
  const { rows } = await pool.query<Candidato>(
    `
    select distinct e.id as empresa_id, e.cnpj, e.dominio, e.razao_social
    from sdr_leads l
    join empresas e on e.id = l.empresa_id
    where l.origem = 'distribuicao'
      and l.encerrado_em is null
      and l.estagio = 'a_contatar'
      and l.distribuido_em > now() - ($1 || ' days')::interval
      and not exists (
        select 1 from enriquecimentos x
        where x.tipo = 'contatos'
          -- A checagem de nulo vem primeiro: empresa sem domínio nunca casa
          -- aqui, então ela SOBRA como candidata — que é o certo, porque o passo
          -- seguinte é justamente resolver o domínio dela.
          and e.dominio is not null
          and x.dominio = e.dominio
          and x.status in ('sucesso', 'sem_dados')
          and x.executado_em > now() - ($2 || ' days')::interval
      )
    order by e.id
    limit $3
  `,
    [String(janela), String(ttl.contatos), limite],
  )

  acc.candidatos = rows.length
  if (rows.length === 0) return acc

  for (const c of rows) {
    let dominio = c.dominio

    // ── Domínio, só as etapas gratuitas ──────────────────────────────────
    if (!dominio) {
      try {
        const d = await dominioEmpresa(c.empresa_id, { incluirClaude: false })
        dominio = d.dominio
        if (dominio) acc.dominios_resolvidos++
      } catch (e) {
        logger.warn(
          { empresa: c.razao_social, erro: e instanceof Error ? e.message : String(e) },
          'Cascata de domínio falhou para lead distribuído; as outras empresas seguem.',
        )
        acc.falhas++
        continue
      }
    }

    if (!dominio) {
      // Sem domínio o Apollo não tem por onde começar. Não é falha — é uma
      // empresa que só existe fora da web, e a cascata paga resolveria parte
      // disso se alguém decidir ligá-la.
      acc.sem_dominio++
      continue
    }

    // ── Contatos do Apollo ───────────────────────────────────────────────
    // `forcar` desligado de propósito: aqui o cache é o que protege o
    // orçamento. Quem quiser ignorá-lo tem o botão da ficha, que é um clique
    // deliberado sobre uma empresa só.
    try {
      const r = await contatosEmpresa({ empresaId: c.empresa_id })
      if (r.processados > 0) acc.com_contatos++
    } catch (e) {
      logger.warn(
        { empresa: c.razao_social, erro: e instanceof Error ? e.message : String(e) },
        'Busca de contatos falhou para lead distribuído; as outras empresas seguem.',
      )
      acc.falhas++
    }
  }

  logger.info(acc, 'Enriquecimento de leads distribuídos concluído.')
  return acc
}
