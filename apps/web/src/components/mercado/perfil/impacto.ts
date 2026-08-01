import { compileFaixaToPostgrest, type Sugestao } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * O impacto simulado do card de sugestão (§6).
 *
 * É um dry-run REAL, pelo mesmo caminho do preview do editor — não uma
 * estimativa. Um card que dissesse "≈2.400 empresas" e o editor mostrasse 900
 * destruiria a confiança nos dois, e a pessoa passaria a não acreditar em número
 * nenhum da tela.
 *
 * Duas rotas, porque as duas réguas vivem em superfícies diferentes:
 *
 *   CAMADA → `/api/mercado/previa`, que roda no worker. A contagem varre ~880 mil
 *            linhas e, sob RLS no browser, estoura o statement_timeout de 8s
 *            todas as vezes.
 *
 *   FAIXA  → PostgREST direto sobre `notas_funil`. São 15.870 notas e o filtro é
 *            indexado; não há motivo para envolver o worker.
 */

export async function simularImpacto(sugestao: Sugestao): Promise<string | null> {
  return sugestao.alvo.tipo === 'camada'
    ? impactoDeCamada(sugestao)
    : impactoDeFaixa(sugestao)
}

interface PreviaRegra {
  subindo: number
  descendo: number
  permanecem: number
}

async function impactoDeCamada(sugestao: Sugestao): Promise<string | null> {
  const resposta = await fetch('/api/mercado/previa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ camada: sugestao.alvo.chave, definicao: sugestao.definicao_proposta }),
  })
  if (!resposta.ok) return null

  const p = (await resposta.json()) as PreviaRegra
  const camada = sugestao.alvo.chave.toUpperCase()

  if (p.subindo === 0 && p.descendo === 0) {
    return `Aplicar não moveria nenhuma empresa — a régua já cobre quem este ajuste incluiria.`
  }
  const partes: string[] = []
  if (p.subindo > 0) partes.push(`adiciona ${inteiro(p.subindo)} empresas ao ${camada}`)
  if (p.descendo > 0) partes.push(`tira ${inteiro(p.descendo)}`)
  return `Aplicar ${partes.join(' e ')}.`
}

/**
 * Quantas NFs a regra proposta passaria a capturar.
 *
 * Só as ABERTAS e em faixa nenhuma ou em faixa inferior: a pergunta útil é
 * "quantas notas isto move PARA a faixa alta", e contar as que já estão lá
 * infla o número com o que não mudaria.
 */
async function impactoDeFaixa(sugestao: Sugestao): Promise<string | null> {
  let filtro: string
  try {
    filtro = compileFaixaToPostgrest(sugestao.definicao_proposta)
  } catch {
    return null
  }

  const supabase = createClient()
  const { count, error } = await supabase
    .from('notas_funil')
    .select('access_key', { count: 'exact', head: true })
    .or(filtro)
    .eq('operavel', true)
    .in('estagio_funil', ['a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento'])
    .neq('faixa', sugestao.alvo.chave)
  if (error) return null

  const n = count ?? 0
  if (n === 0) {
    return 'Aplicar não moveria nenhuma nota viva — a régua atual já cobre o que este ajuste incluiria.'
  }
  return `Aplicar move ~${inteiro(n)} nota${n > 1 ? 's' : ''} viva${n > 1 ? 's' : ''} para a faixa ${sugestao.alvo.chave}.`
}

function inteiro(n: number): string {
  return n.toLocaleString('pt-BR')
}
