import type { ContatoCandidato } from '../../../../packages/core/src/campanhas/publico.js'
import type { CanalThread } from '../../../../packages/core/src/comunicacao/schemas.js'
import { pool } from '../db.js'

/**
 * OS FATOS DE UM PÚBLICO INTEIRO, EM POUCAS CONSULTAS.
 *
 * O motor de exclusão é puro e decide um destinatário por vez; alimentá-lo com
 * uma consulta por pessoa transformaria uma simulação de 5.000 empresas em 30 mil
 * round-trips. Aqui tudo é buscado em lote e indexado em `Map`, e o laço de
 * decisão fica em memória.
 *
 * É por isso que este arquivo é SQL cru e não PostgREST: `= any($1)` sobre um
 * array de milhares de ids é uma consulta; o mesmo em PostgREST é uma URL que
 * estoura o limite de tamanho.
 */

export interface FatosDoPublico {
  contatosPorEmpresa: Map<string, ContatoCandidato[]>
  suprimidos: Set<string>
  /** Empresas com processo jurídico nosso ativo. */
  comProcesso: Set<string>
  gestaoPorEmpresa: Map<string, string | null>
  /** Contatos com conversa viva. */
  comConversaAberta: Set<string>
  /** Último toque por contato (saída registrada no ledger). */
  ultimoToquePorContato: Map<string, Date>
  /** Contatos que já estão em outra campanha ativa. */
  emOutraCampanha: Set<string>
  /** Quantas campanhas cada contato recebeu nos últimos 90 dias. */
  campanhasNoTrimestre: Map<string, number>
}

export async function coletarFatos(args: {
  empresaIds: readonly string[]
  canal: CanalThread
  campanhaId: string | null
}): Promise<FatosDoPublico> {
  const { empresaIds, canal, campanhaId } = args
  const ids = [...empresaIds]

  if (ids.length === 0) {
    return {
      contatosPorEmpresa: new Map(),
      suprimidos: new Set(),
      comProcesso: new Set(),
      gestaoPorEmpresa: new Map(),
      comConversaAberta: new Set(),
      ultimoToquePorContato: new Map(),
      emOutraCampanha: new Set(),
      campanhasNoTrimestre: new Map(),
    }
  }

  const [contatos, empresas, conversas, toques, outras, trimestre] = await Promise.all([
    pool.query<ContatoCandidato>(
      `select id, empresa_id, nome, cargo, email, telefone, whatsapp,
              ponto_focal, nao_e_o_decisor, base_legal, criado_em
       from contatos where empresa_id = any($1)`,
      [ids],
    ),
    /*
     * `tem_processo_nosso_ativo` é coluna materializada em `empresas`, mantida
     * pelo módulo Jurídico (04j) — a mesma que `mercado_explorador` expõe ao
     * construtor de filtros. Recalculá-la aqui a partir dos processos daria uma
     * segunda definição de "processo ativo", e as duas divergiriam no primeiro
     * dia em que o Jurídico mudasse a régua dele.
     */
    pool.query<{ id: string; cnpj: string; gestao_operacao: string | null; tem_processo: boolean }>(
      `select e.id, e.cnpj, e.gestao_operacao,
              coalesce(e.tem_processo_nosso_ativo, false) as tem_processo
       from empresas e where e.id = any($1)`,
      [ids],
    ),
    /*
     * Conversa "viva" = falamos e ainda não encerramos. `pausada` conta como
     * viva de propósito: pausada é uma decisão de alguém, e um disparo por cima
     * dela é justamente o atropelo que a pausa queria evitar.
     */
    pool.query<{ contato_id: string }>(
      `select distinct cv.contato_id
       from conversas cv
       where cv.contato_id is not null
         and cv.empresa_id = any($1)
         and cv.status <> 'encerrada'`,
      [ids],
    ),
    pool.query<{ contato_id: string; ultimo: string }>(
      `select contato_id, max(coalesce(enviado_em, criado_em)) as ultimo
       from comunicacoes
       where contato_id is not null
         and empresa_id = any($1)
         and direcao = 'saida'
       group by contato_id`,
      [ids],
    ),
    pool.query<{ contato_id: string }>(
      `select distinct d.contato_id
       from campanha_destinatarios d
       join campanhas c on c.id = d.campanha_id
       where d.contato_id is not null
         and d.empresa_id = any($1)
         and c.status in ('agendada', 'executando', 'pausada')
         and d.status in ('pendente', 'agendada', 'enviada')
         and ($2::uuid is null or c.id <> $2)`,
      [ids, campanhaId],
    ),
    pool.query<{ contato_id: string; n: number }>(
      `select d.contato_id, count(distinct d.campanha_id)::int as n
       from campanha_destinatarios d
       where d.contato_id is not null
         and d.empresa_id = any($1)
         and d.enviada_em > now() - interval '90 days'
         and ($2::uuid is null or d.campanha_id <> $2)
       group by d.contato_id`,
      [ids, campanhaId],
    ),
  ])

  // ── Supressão: por valor do canal E por CNPJ da empresa ──────────────────
  // As duas formas existem porque as duas são pedidas: uma pessoa pede para não
  // receber, e uma EMPRESA pede para a casa inteira não ser abordada.
  const escopos = canal === 'email' ? ['email'] : ['whatsapp', 'telefone']
  const valores = contatos.rows.flatMap((c) =>
    canal === 'email' ? [c.email] : [c.whatsapp, c.telefone],
  )
  const cnpjs = empresas.rows.map((e) => e.cnpj).filter(Boolean)

  const supressao = await pool.query<{ escopo: string; valor: string }>(
    `select escopo, valor from supressao
     where (expira_em is null or expira_em >= current_date)
       and ((escopo = any($1) and valor = any($2)) or (escopo = 'empresa' and valor = any($3)))`,
    [escopos, valores.filter((v): v is string => !!v), cnpjs],
  )

  const cnpjSuprimido = new Set(
    supressao.rows.filter((s) => s.escopo === 'empresa').map((s) => s.valor),
  )
  const valorSuprimido = new Set(
    supressao.rows.filter((s) => s.escopo !== 'empresa').map((s) => s.valor),
  )

  const suprimidos = new Set<string>()
  const empresaPorId = new Map(empresas.rows.map((e) => [e.id, e]))
  for (const c of contatos.rows) {
    const emp = empresaPorId.get(c.empresa_id)
    if (emp && cnpjSuprimido.has(emp.cnpj)) {
      suprimidos.add(c.id)
      continue
    }
    const meus = canal === 'email' ? [c.email] : [c.whatsapp, c.telefone]
    if (meus.some((v) => v && valorSuprimido.has(v))) suprimidos.add(c.id)
  }

  const contatosPorEmpresa = new Map<string, ContatoCandidato[]>()
  for (const c of contatos.rows) {
    const lista = contatosPorEmpresa.get(c.empresa_id)
    if (lista) lista.push(c)
    else contatosPorEmpresa.set(c.empresa_id, [c])
  }

  return {
    contatosPorEmpresa,
    suprimidos,
    comProcesso: new Set(empresas.rows.filter((e) => e.tem_processo).map((e) => e.id)),
    gestaoPorEmpresa: new Map(empresas.rows.map((e) => [e.id, e.gestao_operacao])),
    comConversaAberta: new Set(conversas.rows.map((r) => r.contato_id)),
    ultimoToquePorContato: new Map(
      toques.rows.filter((r) => r.ultimo).map((r) => [r.contato_id, new Date(r.ultimo)]),
    ),
    emOutraCampanha: new Set(outras.rows.map((r) => r.contato_id)),
    campanhasNoTrimestre: new Map(trimestre.rows.map((r) => [r.contato_id, Number(r.n)])),
  }
}
