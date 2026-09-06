import 'server-only'

import {
  projetarComissao,
  resolverConfig,
  type BlocoMeuDia,
  type ItemProjetavel,
  type MeuDia,
  type OverrideBloco,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/server'

/**
 * A carga do Meu Dia, do lado do servidor.
 *
 * UMA ida ao banco para os blocos (o RPC `meu_dia`), mais duas leituras minúsculas: os
 * overrides de configuração do cargo e os parâmetros de comissão. Não há N+1 em lugar
 * nenhum — e não há um segundo agregador escrito aqui que pudesse discordar do primeiro.
 *
 * A COMISSÃO PROJETADA é calculada AQUI, e não no SQL, de propósito: ela roda o motor do
 * 04k (`projetarComissao`, que reusa `determinarFase`, `calcularVOP` e as mesmas chaves
 * de taxa). Uma reimplementação em plpgsql seria uma segunda régua para o mesmo número —
 * e no dia em que as duas divergissem, a tela prometeria o que a folha não paga.
 */

export interface MeuDiaCarregado extends MeuDia {
  /** "Se tudo converter." O rótulo honesto está na tela; aqui é só o número. */
  comissao_projetada: number
  /** Overrides vigentes, para a tela poder explicar de onde vem cada limiar. */
  config: Record<string, { ativo: boolean; max_itens: number; limiares: Record<string, number> }>
}

const VAZIO: MeuDia = {
  tem_acesso: false,
  vendedor_id: null,
  vendedor_nome: null,
  tipo: null,
  espelhado: false,
  gerado_em: new Date().toISOString(),
  blocos: [],
  mapa_carteira: [],
  evolucao: [],
  funil_semana: [],
}

/**
 * Os itens que valem projeção, e só eles.
 *
 * Nem todo item do dia vira comissão: uma conversa parada não tem VOP, e uma tarefa
 * manual não tem conta. Projetar sobre tudo o que tem `valor` inflaria o número com
 * potencial de fornecedor e limite de crédito, que são grandezas de outra natureza.
 *
 * Sobram DOIS blocos em que "converter" significa uma CESSÃO com uma conta identificável:
 * a nota de faixa alta e a antecipação que travou. `cedentes_que_pararam` fica de fora de
 * propósito — o item ali é um cedente somando meses de várias contas diferentes, e a taxa
 * do 04k depende da classificação de UMA conta. Projetar sobre ele exigiria escolher uma
 * `gestao_operacao` arbitrária, que é a forma mais discreta de inventar um número.
 */
const BLOCOS_PROJETAVEIS = new Set(['nfs_alta_nao_prospectadas', 'antecipacoes_travadas'])

/**
 * Prazo presumido: a cessão ainda não existe, então o prazo dela também não.
 *
 * 30 dias é o denominador do VOP, ou seja, a ponderação NEUTRA — a projeção não infla nem
 * desconta por um prazo que ninguém negociou ainda. Um chute maior faria a tela prometer
 * mais do que a folha pagaria na conversão de uma nota curta.
 */
const DIAS_PRESUMIDOS = 30

interface ContaProjetavel {
  gestao_operacao: string | null
  marco_ativacao: string | null
}

function projetaveis(
  blocos: readonly BlocoMeuDia[],
  cargo: string | null,
  contas: Map<string, ContaProjetavel>,
): ItemProjetavel[] {
  const out: ItemProjetavel[] = []
  for (const bloco of blocos) {
    if (!BLOCOS_PROJETAVEIS.has(bloco.tipo)) continue
    for (const item of bloco.itens) {
      if (!item.valor || item.valor <= 0 || !item.empresa_id) continue
      const conta = contas.get(item.empresa_id)
      out.push({
        valor: item.valor,
        dias: DIAS_PRESUMIDOS,
        // Sem classificação da conta não há taxa possível, e `projetarComissao` devolve
        // zero para o item — que é o mesmo que o motor faz na hora de lançar.
        gestaoOperacao: (conta?.gestao_operacao ?? null) as ItemProjetavel['gestaoOperacao'],
        marcoAtivacao: conta?.marco_ativacao ?? null,
        souVendedor: cargo === 'vendedor',
        souOriginador: cargo === 'originador',
      })
    }
  }
  return out
}

export async function carregarMeuDia(vendedorId?: string | null): Promise<MeuDiaCarregado> {
  const supabase = await createClient()

  /*
   * O CARGO PRECEDE A CONFIG, e a config precede os blocos — é o cargo que decide quais
   * blocos existem. Por isso a primeira ida ao banco descobre de quem é o dia.
   *
   * `app_meu_dia_cargo` resolve as três hipóteses num lugar só (alvo explícito do gestor,
   * closer de quem é auxiliar, ou eu mesmo) e devolve o mesmo cargo que o agregador vai
   * usar. Repetir a regra aqui em TypeScript seria a segunda régua que a 04p inteira
   * existe para não ter.
   */
  const alvo = vendedorId ?? null
  const { data: cargoAlvo } = await supabase.rpc('app_meu_dia_cargo' as never, {
    p_vendedor_id: alvo,
  } as never)
  const tipo = (cargoAlvo as string | null) ?? null

  const { data: cfgRow } = tipo
    ? await supabase.from('meu_dia_config').select('blocos').eq('tipo_vendedor', tipo).maybeSingle()
    : { data: null }

  const overrides = (cfgRow?.blocos ?? {}) as Record<string, OverrideBloco>
  const config = resolverConfig(tipo, overrides)

  const { data, error } = await supabase.rpc('meu_dia' as never, {
    p_vendedor_id: alvo,
    p_config: config,
  } as never)
  if (error) throw new Error(error.message)

  const dia = { ...VAZIO, ...((data ?? {}) as Partial<MeuDia>) } as MeuDia
  if (!dia.tem_acesso) return { ...dia, comissao_projetada: 0, config }

  const cargo = (data as { cargo?: string })?.cargo ?? tipo

  /*
   * A classificação e o marco de ativação das contas dos itens projetáveis, numa consulta
   * só — `in` sobre os ids distintos, e não uma leitura por item. São as duas grandezas
   * que o motor do 04k usa para achar a fase e a taxa; sem elas a projeção seria zero
   * para tudo, e com uma consulta por item seria o N+1 que o agregador existe para evitar.
   */
  const ids = [
    ...new Set(
      dia.blocos
        .filter((b) => BLOCOS_PROJETAVEIS.has(b.tipo))
        .flatMap((b) => b.itens.map((i) => i.empresa_id))
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const [{ data: params }, { data: contasRows }] = await Promise.all([
    supabase
      .from('commission_params')
      .select('id, chave, vendedor_id, valor, unidade, vigente_de, vigente_ate'),
    ids.length > 0
      ? supabase.from('empresas').select('id, gestao_operacao, marco_ativacao').in('id', ids)
      : Promise.resolve({ data: [] as { id: string; gestao_operacao: string | null; marco_ativacao: string | null }[] }),
  ])

  const contas = new Map(
    (contasRows ?? []).map((c) => [
      c.id,
      { gestao_operacao: c.gestao_operacao, marco_ativacao: c.marco_ativacao },
    ]),
  )

  const comissao = dia.vendedor_id
    ? projetarComissao(
        projetaveis(dia.blocos, cargo, contas),
        (params ?? []).map((p) => ({ ...p, valor: Number(p.valor) })),
        dia.vendedor_id,
      )
    : 0

  return { ...dia, comissao_projetada: comissao, config }
}
