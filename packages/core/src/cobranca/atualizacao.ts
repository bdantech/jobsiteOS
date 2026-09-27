import { calcularDivida, type ResultadoCalculo, type TabelaIndices } from '../juridico/calculo.js'
import { INDICE_COBRANCA_LABELS, type IndiceCobranca, type ParametrosAtualizacao } from './schemas.js'

/**
 * Dívida atualizada da cobrança (Prompt 07 §9.1) — o motor do Jurídico, não uma cópia.
 *
 *   principal → correção → juros de mora (sobre o corrigido) → multa (sobre o corrigido)
 *   → honorários (sobre o subtotal)
 *
 * É exatamente a ordem e as bases do `calcularDivida` do Prompt 08. O que a cobrança
 * pede a mais — índice "nenhum" e juros por mês cheio — entrou lá como `opcoes`, com
 * defaults que não mudam nada para o Jurídico. Custas não existem aqui: cobrança
 * extrajudicial não tem custas processuais, e o protesto tem as dele, pagas à parte.
 */

export interface TituloAtualizacao {
  id: string
  valor_face: number
  vencimento: string
  descricao?: string | null
  access_key?: string | null
  antecipacao_id_externo?: number | null
}

export interface ResultadoAtualizacao extends ResultadoCalculo {
  /** O índice da COBRANÇA (pode ser `nenhum`, que o Jurídico não conhece). */
  indice_cobranca: IndiceCobranca
  parametros_cobranca: ParametrosAtualizacao
}

export function atualizarDividaCobranca(
  titulos: readonly TituloAtualizacao[],
  parametros: ParametrosAtualizacao,
  tabela: TabelaIndices,
  dataBase: string,
): ResultadoAtualizacao {
  const indice = parametros.indice
  const semIndice = indice === 'nenhum'
  const r = calcularDivida(
    titulos.map((t) => ({
      id: t.id,
      valor_original: t.valor_face,
      vencimento: t.vencimento,
      descricao: t.descricao ?? null,
      access_key: t.access_key ?? null,
      antecipacao_id_externo: t.antecipacao_id_externo ?? null,
    })),
    {
      // com correção desligada o índice não é consultado; o valor é só um tipo válido
      indice: indice === 'nenhum' ? 'ipca' : indice,
      juros_am: parametros.juros_mora_mes,
      juros_compostos: false,
      multa_pct: parametros.multa_pct,
      honorarios_pct: parametros.honorarios_pct,
      incluir_custas: false,
    },
    tabela,
    dataBase,
    0,
    { corrigir: !semIndice, jurosProRata: parametros.juros_pro_rata },
  )
  return { ...r, indice_cobranca: parametros.indice, parametros_cobranca: parametros }
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * A memória de cálculo em texto para a carta e o dossiê: os parâmetros, uma linha por
 * título e os totais. É a mesma conta da tela, escrita de um jeito que o devedor e o
 * advogado dele consigam refazer.
 */
export function memoriaAtualizacaoMarkdown(r: ResultadoAtualizacao): string {
  const p = r.parametros_cobranca
  const linhas: string[] = [
    `Data-base: ${dataBr(r.data_base)} · Correção: ${INDICE_COBRANCA_LABELS[r.indice_cobranca]} · ` +
      `Juros de mora: ${pct(p.juros_mora_mes)} a.m. (${p.juros_pro_rata ? 'pro rata die' : 'por mês completo'}) · ` +
      `Multa: ${pct(p.multa_pct)} · Honorários: ${pct(p.honorarios_pct)}`,
    '',
    '| Título | Vencimento | Dias | Principal | Correção | Juros | Multa | Subtotal |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ]
  for (const l of r.memoria) {
    linhas.push(
      `| ${l.descricao ?? l.operacao_id} | ${dataBr(l.vencimento)} | ${l.dias_em_atraso} | ${brl(l.principal)} | ` +
        `${brl(l.correcao)} | ${brl(l.juros)} | ${brl(l.multa)} | ${brl(l.subtotal)} |`,
    )
  }
  linhas.push(
    '',
    `Principal ${brl(r.principal)} + correção ${brl(r.correcao)} + juros ${brl(r.juros)} + multa ${brl(r.multa)} ` +
      `+ honorários ${brl(r.honorarios)} = **${brl(r.total)}**`,
  )
  if (r.competencias_sem_indice.length > 0) {
    linhas.push('', `Competências sem índice publicado (corrigidas por fator 1): ${r.competencias_sem_indice.join(', ')}.`)
  }
  return linhas.join('\n')
}
