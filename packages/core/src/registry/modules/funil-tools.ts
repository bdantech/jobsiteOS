import { formatCnpj, normalizeCnpj } from '../../schemas/cnpj.js'
import { ESTAGIOS_ABERTOS } from '../../antecipacao/schemas.js'
import {
  TIPO_OPORTUNIDADE_LABELS,
  oportunidadesFunilSchema,
  preauthsExpirandoSchema,
  type OportunidadesFunilInput,
  type PreauthsExpirandoInput,
  type TipoOportunidade,
} from '../../funil/schemas.js'
import type { ModuleTool, ToolContext } from '../types.js'

/**
 * As tools do funil unificado (04s §10).
 *
 * Moram em arquivo próprio e entram no módulo Antecipação pela mesma porta das
 * tools de Sacados por NF: a aba é da Antecipação e a régua de acesso é a mesma.
 *
 * As duas LEEM A PROJEÇÃO, que é `security_invoker` — o que a RLS esconder, a tool
 * não vê. Isso não é detalhe de implementação: significa que perguntar ao agente
 * "o que tem no funil?" devolve o funil DE QUEM PERGUNTOU, e não o da casa.
 */

/**
 * Em UMA string literal, nunca concatenada: supabase-js parseia o select no NÍVEL
 * DE TIPO, e emendar literais estoura o parser — o resultado degrada em silêncio
 * para `GenericStringError` e todo acesso a coluna vira erro de compilação.
 */
const COLUNAS =
  'tipo, id, access_key, valor, vencimento, dias_para_vencimento, data_base, numero_exibicao, estado_origem, relogio, linha_contexto, faixa, faixa_motivo, estagio_funil, receita_esperada, liquido_estimado, fornecedor_cnpj, fornecedor_nome, fornecedor_cadastrado, fornecedor_tipagem, credor_pessoa_fisica, sacado_cnpj, sacado_nome, sacado_matriz_cnpj, sacado_credito_status, sacado_limite_cobre_valor, pre_autorizacao_id, pre_autorizacao_status, vendedor_id'

async function oportunidades(input: OportunidadesFunilInput, ctx: ToolContext) {
  let query = ctx.supabase
    .from('funil_oportunidades')
    .select(COLUNAS)
    .in('estagio_funil', [...ESTAGIOS_ABERTOS])
    .order('receita_esperada', { ascending: false, nullsFirst: false })
    .limit(input.limite)

  if (input.tipo?.length) query = query.in('tipo', input.tipo)
  if (input.faixa) query = query.eq('faixa', input.faixa)
  if (input.fornecedor_cnpj) query = query.eq('fornecedor_cnpj', normalizeCnpj(input.fornecedor_cnpj))
  // Pela MATRIZ, e não pelo CNPJ escrito no documento: quem pergunta por uma
  // construtora quer as SPEs dela junto — é assim que a casa pensa a conta.
  if (input.sacado_cnpj) query = query.eq('sacado_matriz_cnpj', normalizeCnpj(input.sacado_cnpj))

  const { data, error } = await query
  if (error) throw new Error(`Falha ao listar as oportunidades do funil: ${error.message}`)

  const itens = data ?? []
  const porTipo = new Map<string, { qtd: number; valor: number; receita: number }>()
  for (const i of itens) {
    const t = String(i.tipo)
    const ac = porTipo.get(t) ?? { qtd: 0, valor: 0, receita: 0 }
    ac.qtd++
    ac.valor += Number(i.valor ?? 0)
    ac.receita += Number(i.receita_esperada ?? 0)
    porTipo.set(t, ac)
  }

  return {
    total: itens.length,
    // A quebra por tipo é o que responde "de onde está vindo o pipeline?" — a
    // pergunta que a unificação criou e que nenhuma das fontes responde sozinha.
    por_tipo: [...porTipo.entries()].map(([tipo, v]) => ({
      tipo,
      label: TIPO_OPORTUNIDADE_LABELS[tipo as TipoOportunidade] ?? tipo,
      ...v,
    })),
    valor_total: itens.reduce((s, i) => s + Number(i.valor ?? 0), 0),
    receita_esperada_total: itens.reduce((s, i) => s + Number(i.receita_esperada ?? 0), 0),
    oportunidades: itens,
    route: '/antecipacao',
  }
}

async function preauthsExpirando(input: PreauthsExpirandoInput, ctx: ToolContext) {
  const limite = new Date(Date.now() + input.dias * 86_400_000).toISOString()

  const { data, error } = await ctx.supabase
    .from('funil_oportunidades')
    .select(COLUNAS)
    // `estado_origem` é o vocabulário da FONTE; para a pré-autorização ele é o
    // `status`, e `WAITING_CONTRACTED` é o único que ainda dá para salvar.
    .eq('tipo', 'pre_autorizacao')
    .eq('estado_origem', 'WAITING_CONTRACTED')
    .not('relogio', 'is', null)
    .gte('relogio', new Date().toISOString())
    .lte('relogio', limite)
    // Pelo RELÓGIO, e não pela receita: aqui a ordem do trabalho é a ordem em que
    // as coisas deixam de existir.
    .order('relogio', { ascending: true })
    .limit(input.limite)

  if (error) throw new Error(`Falha ao listar as pré-autorizações expirando: ${error.message}`)

  const itens = data ?? []
  return {
    dias: input.dias,
    total: itens.length,
    valor_total: itens.reduce((s, i) => s + Number(i.valor ?? 0), 0),
    /*
     * A frase que resume por que esta tool existe: não há nada a convencer. A
     * construtora já ofereceu e o crédito já está reservado — falta o fornecedor
     * clicar, e o trabalho é um telefonema antes de o prazo acabar.
     */
    resumo:
      itens.length === 0
        ? 'Nenhuma oferta com relógio curto. Nada a salvar hoje.'
        : `${itens.length} oferta(s) já feitas pela construtora expiram em até ${input.dias} dia(s). ` +
          'O crédito já existe; falta o fornecedor aceitar.',
    expirando: itens.map((i) => ({
      ...i,
      fornecedor_cnpj_formatado: i.fornecedor_cnpj ? formatCnpj(String(i.fornecedor_cnpj)) : null,
    })),
    route: '/antecipacao?tipo=pre_autorizacao',
  }
}

export const funilTools: ModuleTool[] = [
  {
    id: 'funil.oportunidades',
    name: 'Oportunidades do funil',
    description:
      'O funil de antecipação com as TRÊS origens juntas: notas fiscais, pré-autorizações (ofertas ' +
      'que a construtora já fez) e parcelas de título do ERP Sienge. Aceita filtro por tipo, faixa, ' +
      'fornecedor e sacado (que casa pela MATRIZ, trazendo as SPEs junto). Traz a quebra por origem, ' +
      'que é o que responde "de onde está vindo o pipeline?".',
    inputSchema: oportunidadesFunilSchema,
    mutates: false,
    execute: (input, ctx) => oportunidades(input as OportunidadesFunilInput, ctx),
  },
  {
    id: 'funil.preauths_expirando',
    name: 'Pré-autorizações expirando',
    description:
      'As ofertas de antecipação que a construtora JÁ FEZ ao fornecedor e que expiram nos próximos ' +
      'dias, da mais urgente para a menos. É o item mais perecível do sistema: o crédito já existe e ' +
      'o dinheiro já está reservado — falta o fornecedor aceitar, e o trabalho é um telefonema antes ' +
      'de o prazo acabar. Responde "o que eu perco se não ligar hoje?".',
    inputSchema: preauthsExpirandoSchema,
    mutates: false,
    execute: (input, ctx) => preauthsExpirando(input as PreauthsExpirandoInput, ctx),
  },
]
