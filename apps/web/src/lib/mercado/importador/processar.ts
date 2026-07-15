import 'server-only'

import type { Json, MapeamentoImportacao, Tables, TablesInsert } from '@jobsiteos/core'
import { extrairLinha } from '@/components/mercado/importador/mapeamento'
import type { Candidato } from '@/components/mercado/importador/similaridade'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  criarBuscadorDeCandidatos,
  MAX_CONSULTAS_UNIVERSO,
  type ClienteServidor,
} from './candidatos'
import { lerPlanilha } from './planilha'
import { baixarArquivo } from './storage'

/**
 * Da planilha para `importacoes_linhas`: uma linha de origem = uma linha aqui,
 * SEMPRE. Nada é descartado em silêncio — é isso que a spec chama de
 * rastreabilidade total (§5.5). Uma linha duplicada, uma linha sem CNPJ e uma
 * linha que o revisor ignorou continuam todas no banco, com o motivo legível no
 * status.
 *
 * O significado de cada status aqui:
 *   resolvida — tem CNPJ válido (da planilha) e é a PRIMEIRA ocorrência dele.
 *   ignorada  — CNPJ válido, mas repetido dentro do próprio arquivo (dedup).
 *               `cnpj_resolvido` fica preenchido: é o que distingue uma linha
 *               duplicada de uma que o revisor ignorou (essa fica sem CNPJ).
 *   ambigua   — sem CNPJ utilizável. Vai para a fila de resolução com os
 *               candidatos do universo, e só um humano tira ela de lá.
 *   pendente  — sem CNPJ e sem razão social: não há nem o que buscar. Fica
 *               visível na fila, mas sem candidatos.
 */

/**
 * ⚠️ CLIENT DE SERVIÇO NO INSERT — e é a única forma possível.
 *
 * A migração 0012 criou em `importacoes_linhas` exatamente duas policies: SELECT e
 * UPDATE (esta última para o revisor resolver as linhas ambíguas). NÃO existe
 * policy de INSERT nem de DELETE — e as duas ausências se comportam de formas
 * diferentes, o que é a parte traiçoeira:
 *   INSERT sem policy → erro 42501, a importação inteira falha;
 *   DELETE sem policy → casa ZERO linhas, em silêncio, e "reprocessar" deixaria
 *                       as linhas do mapeamento antigo no banco, misturadas com
 *                       as novas.
 * (Os GRANTs de tabela existem — são os defaults do Supabase para `authenticated`
 * —, mas grant e policy são AND: sem policy, nada passa.)
 *
 * As linhas da importação são gravadas, portanto, com o client de serviço — o que
 * é seguro porque:
 *   1. a autorização (sessão + módulo `mercado`) já foi feita na server action
 *      que chamou esta função, e o dono da importação foi lido do banco;
 *   2. o que se escreve aqui é ESTAGING da própria importação, não entidade de
 *      negócio: nenhuma linha de `empresas` ou `contatos` passa por aqui.
 * As mutações de negócio (aplicar.ts) usam o client do usuário e os write helpers
 * do core, com o RLS ligado.
 */

export interface ResultadoProcessamento {
  total: number
  resolvidas: number
  ambiguas: number
  ignoradas: number
  /** Consultas ao universo estouraram o teto: algumas linhas ficaram sem candidatos. */
  buscaTruncada: boolean
}

const TAMANHO_LOTE_INSERT = 500

export async function processarImportacao(
  supabase: ClienteServidor,
  importacao: Tables<'importacoes_listas'>,
  mapeamento: MapeamentoImportacao,
): Promise<ResultadoProcessamento> {
  if (!importacao.arquivo_url) {
    throw new Error('A importação não tem arquivo associado.')
  }

  const buffer = await baixarArquivo(importacao.arquivo_url)
  const planilha = lerPlanilha(buffer, importacao.arquivo_url)

  const admin = createAdminClient()

  // Reprocessar (o usuário voltou e trocou o mapeamento) apaga o que havia: as
  // linhas antigas foram extraídas com OUTRO mapeamento e não descrevem mais o
  // arquivo. Não há policy de DELETE para `authenticated`, e um delete sem policy
  // não falha — ele apaga zero linhas. Daí o client de serviço também aqui.
  const { error: erroLimpeza } = await admin
    .from('importacoes_linhas')
    .delete()
    .eq('importacao_id', importacao.id)

  if (erroLimpeza) throw new Error(`Falha ao limpar linhas anteriores: ${erroLimpeza.message}`)

  const buscador = criarBuscadorDeCandidatos(supabase)
  const cnpjsVistos = new Set<string>()
  const linhas: TablesInsert<'importacoes_linhas'>[] = []

  let resolvidas = 0
  let ambiguas = 0
  let ignoradas = 0

  for (const bruta of planilha.linhas) {
    const extraida = extrairLinha(bruta, mapeamento)
    const dados = bruta as unknown as Json

    if (extraida.cnpj) {
      const duplicada = cnpjsVistos.has(extraida.cnpj)
      cnpjsVistos.add(extraida.cnpj)

      if (duplicada) ignoradas++
      else resolvidas++

      linhas.push({
        importacao_id: importacao.id,
        dados,
        cnpj_resolvido: extraida.cnpj,
        status: duplicada ? 'ignorada' : 'resolvida',
        candidatos: null,
      })
      continue
    }

    // Sem CNPJ utilizável: fila de resolução.
    const candidatos: Candidato[] = extraida.razao_social
      ? await buscador.buscar({
          razao_social: extraida.razao_social,
          uf: extraida.uf,
          municipio: extraida.municipio,
        })
      : []

    ambiguas++
    linhas.push({
      importacao_id: importacao.id,
      dados,
      cnpj_resolvido: null,
      status: extraida.razao_social ? 'ambigua' : 'pendente',
      candidatos: candidatos as unknown as Json,
    })
  }

  for (let i = 0; i < linhas.length; i += TAMANHO_LOTE_INSERT) {
    const lote = linhas.slice(i, i + TAMANHO_LOTE_INSERT)
    const { error } = await admin.from('importacoes_linhas').insert(lote)
    if (error) throw new Error(`Falha ao gravar as linhas da importação: ${error.message}`)
  }

  return {
    total: linhas.length,
    resolvidas,
    ambiguas,
    ignoradas,
    buscaTruncada: buscador.consultas() >= MAX_CONSULTAS_UNIVERSO,
  }
}
