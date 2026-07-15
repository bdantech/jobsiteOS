import 'server-only'

import {
  atualizarEmpresa,
  criarEmpresa,
  formatCnpj,
  promoverEmpresa,
  type Json,
  type MapeamentoImportacao,
  type Tables,
} from '@jobsiteos/core'
import { extrairLinha, type LinhaExtraida } from '@/components/mercado/importador/mapeamento'
import type { ClienteServidor } from './candidatos'

/**
 * Aplicar a importação: as linhas resolvidas viram `empresas` + `contatos`.
 *
 * ESTAS LISTAS PULAM O STAGING (§5.5). Uma lista de prospecção é PRÉ-QUALIFICADA
 * — alguém já sabe que aquelas empresas existem, usam um ERP e pagam por ele —,
 * então ela não entra em `mercado_universo` esperando ser promovida: ela cai
 * direto em `empresas`, com `origem = 'lista'`.
 *
 * ─── SEMÂNTICA DO `erp_mrr` (não erre isto) ─────────────────────────────────
 * `erp_mrr` é o valor mensal que a empresa paga HOJE pelo ERP que usa hoje
 * (`erp_atual`). É INTELIGÊNCIA COMPETITIVA — o tamanho do contrato do
 * concorrente —, NÃO receita da ONE OS. Na tela ele se chama "MRR do ERP".
 *
 * ─── QUEM ESCREVE O QUÊ ─────────────────────────────────────────────────────
 * `empresas` NUNCA é escrita com `.insert()` cru: passa por criarEmpresa /
 * atualizarEmpresa (@jobsiteos/core), que chamam as funções SECURITY INVOKER da
 * migração 0008 — entidade + `empresa_eventos` + `audit_log` na MESMA transação.
 * Um insert direto ganharia a linha e perderia o evento e a auditoria.
 *
 * Os campos que os helpers não cobrem (`origem`, `churn_erp_concorrente`,
 * `erp_detalhes`) e os `contatos` vão por UPDATE/INSERT direto — sempre com o
 * client do USUÁRIO, nunca o de serviço, para que o RLS (`app_tem_modulo`)
 * continue decidindo. O client de serviço não aparece em lugar nenhum deste
 * arquivo, de propósito.
 *
 * ─── CAMADA ─────────────────────────────────────────────────────────────────
 * Depois de gravar a empresa, se o CNPJ existe no universo chamamos
 * `promoverEmpresa` (app_promover_empresa, migração 0015): ela ADOTA a empresa já
 * existente, carrega `camada`, `grupo_id`, `is_spe` e `grafo_sefaz` do universo,
 * mantém `origem = 'lista'` (é coalesce) e liga `mercado_universo.empresa_id`. É
 * exatamente o caso que o comentário da 0015 descreve — a empresa que veio de uma
 * lista e nunca passou pelo staging.
 */

export interface ResultadoLote {
  processadas: number
  empresasCriadas: number
  empresasAtualizadas: number
  contatosCriados: number
  /** Último id percorrido: o cursor da próxima chamada. */
  ultimoId: string | null
  /** Não há mais linhas resolvidas depois deste lote. */
  concluido: boolean
  /** Linhas que falharam, com o motivo. A importação segue; o erro é reportado. */
  erros: string[]
}

/** Quantas linhas por chamada de server action. Mantém cada request curto. */
export const TAMANHO_LOTE = 100

const MAX_ERROS_REPORTADOS = 10

type Linha = Pick<Tables<'importacoes_linhas'>, 'id' | 'dados' | 'cnpj_resolvido'>

interface ErpDetalhesJson {
  [chave: string]: Json | undefined
}

/**
 * `erp_detalhes` é jsonb e acumula: uma segunda lista que só traz `canal` não pode
 * apagar o `qtd_usuarios` que a primeira trouxe. Merge, nunca substituição.
 */
function mesclarErpDetalhes(atual: Json, novos: LinhaExtraida['erp_detalhes']): Json {
  const base: ErpDetalhesJson =
    atual !== null && typeof atual === 'object' && !Array.isArray(atual)
      ? { ...(atual as ErpDetalhesJson) }
      : {}

  for (const [chave, valor] of Object.entries(novos)) {
    if (valor !== undefined) base[chave] = valor
  }

  return base as Json
}

function mesmoTelefone(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a.replace(/\D/g, '') === b.replace(/\D/g, '')
}

function mesmoEmail(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export async function aplicarLote(
  supabase: ClienteServidor,
  importacao: Tables<'importacoes_listas'>,
  mapeamento: MapeamentoImportacao,
  cursor: string | null,
): Promise<ResultadoLote> {
  let query = supabase
    .from('importacoes_linhas')
    .select('id, dados, cnpj_resolvido')
    .eq('importacao_id', importacao.id)
    .eq('status', 'resolvida')
    .not('cnpj_resolvido', 'is', null)
    .order('id', { ascending: true })
    .limit(TAMANHO_LOTE)

  if (cursor) query = query.gt('id', cursor)

  const { data, error } = await query
  if (error) throw new Error(`Falha ao ler as linhas da importação: ${error.message}`)

  const linhas: Linha[] = data ?? []

  if (linhas.length === 0) {
    return {
      processadas: 0,
      empresasCriadas: 0,
      empresasAtualizadas: 0,
      contatosCriados: 0,
      ultimoId: cursor,
      concluido: true,
      erros: [],
    }
  }

  const cnpjs = linhas.map((l) => l.cnpj_resolvido!).filter((c): c is string => Boolean(c))

  // Três leituras para o lote inteiro, em vez de três por linha.
  const [{ data: empresasExistentes }, { data: doUniverso }] = await Promise.all([
    supabase.from('empresas').select('id, cnpj, erp_detalhes, origem').in('cnpj', cnpjs),
    supabase.from('mercado_universo').select('cnpj, razao_social').in('cnpj', cnpjs),
  ])

  const porCnpj = new Map((empresasExistentes ?? []).map((e) => [e.cnpj, e]))
  const universo = new Map((doUniverso ?? []).map((u) => [u.cnpj, u]))

  const idsExistentes = (empresasExistentes ?? []).map((e) => e.id)
  const { data: contatosExistentes } = idsExistentes.length
    ? await supabase
        .from('contatos')
        .select('empresa_id, nome, email, telefone')
        .in('empresa_id', idsExistentes)
    : { data: [] }

  const resultado: ResultadoLote = {
    processadas: 0,
    empresasCriadas: 0,
    empresasAtualizadas: 0,
    contatosCriados: 0,
    ultimoId: cursor,
    concluido: false,
    erros: [],
  }

  for (const linha of linhas) {
    resultado.ultimoId = linha.id
    const cnpj = linha.cnpj_resolvido
    if (!cnpj) continue

    try {
      const dados = (linha.dados ?? {}) as Record<string, string>
      const extraida = extrairLinha(dados, mapeamento)
      const noUniverso = universo.get(cnpj)
      const existente = porCnpj.get(cnpj)

      // A razão social é obrigatória em `empresas`. Quando a linha veio só com o
      // CNPJ, o universo responde por ela; se nem lá existe, o CNPJ formatado é
      // melhor do que uma linha perdida — e a próxima ingestão da Receita corrige.
      const razaoSocial =
        extraida.razao_social ?? noUniverso?.razao_social ?? `Empresa ${formatCnpj(cnpj)}`

      let empresa: Tables<'empresas'>

      if (existente) {
        empresa = await atualizarEmpresa(supabase, {
          id: existente.id,
          ...(extraida.razao_social ? { razao_social: extraida.razao_social } : {}),
          ...(extraida.nome_fantasia ? { nome_fantasia: extraida.nome_fantasia } : {}),
          ...(extraida.uf ? { uf: extraida.uf } : {}),
          ...(extraida.municipio ? { municipio: extraida.municipio } : {}),
          ...(extraida.erp_atual ? { erp_atual: extraida.erp_atual } : {}),
          ...(extraida.erp_mrr !== null ? { erp_mrr: extraida.erp_mrr } : {}),
        })
        resultado.empresasAtualizadas++
      } else {
        empresa = await criarEmpresa(supabase, {
          cnpj,
          razao_social: razaoSocial,
          nome_fantasia: extraida.nome_fantasia,
          uf: extraida.uf,
          municipio: extraida.municipio,
          erp_atual: extraida.erp_atual,
          erp_mrr: extraida.erp_mrr,
          // Uma lista é CLASSIFICAÇÃO, não relacionamento: ninguém falou com elas
          // ainda. O estágio é o default do schema (`mercado`).
        })
        resultado.empresasCriadas++
      }

      // ─── O que os write helpers não cobrem ────────────────────────────────
      const patch: Record<string, Json> = {}

      const erpDetalhes = mesclarErpDetalhes(existente?.erp_detalhes ?? {}, extraida.erp_detalhes)
      if (Object.keys(extraida.erp_detalhes).length > 0) patch.erp_detalhes = erpDetalhes

      // Só escreve quando a coluna de origem disse alguma coisa. `null` = a
      // planilha não fala sobre churn, e o `false` do banco continua valendo.
      if (extraida.churn_erp_concorrente !== null) {
        patch.churn_erp_concorrente = extraida.churn_erp_concorrente
      }

      // A empresa nasce aqui → origem = 'lista'. Uma empresa que já existia com
      // origem 'mercado' (promovida do universo) mantém a sua: reescrever a
      // procedência apagaria de onde ela realmente veio.
      if (!existente?.origem) patch.origem = 'lista'

      if (Object.keys(patch).length > 0) {
        const { error: erroPatch } = await supabase
          .from('empresas')
          .update(patch)
          .eq('id', empresa.id)

        if (erroPatch) throw new Error(erroPatch.message)
      }

      // ─── Camada ───────────────────────────────────────────────────────────
      // Só faz sentido para quem existe no universo. Idempotente (a 0015 devolve
      // a empresa já vinculada sem reemitir o evento).
      if (noUniverso) {
        await promoverEmpresa(supabase, { cnpj })
      }

      // ─── Contato ──────────────────────────────────────────────────────────
      if (extraida.contato) {
        const jaTem = (contatosExistentes ?? []).some(
          (c) =>
            c.empresa_id === empresa.id &&
            (mesmoEmail(c.email, extraida.contato!.email) ||
              mesmoTelefone(c.telefone, extraida.contato!.telefone)),
        )

        if (!jaTem) {
          const { error: erroContato } = await supabase.from('contatos').insert({
            empresa_id: empresa.id,
            nome: extraida.contato.nome,
            cargo: extraida.contato.cargo,
            email: extraida.contato.email,
            telefone: extraida.contato.telefone,
            // A procedência do contato é a lista que o trouxe (§5.5).
            origem: importacao.nome,
          })

          if (erroContato) throw new Error(erroContato.message)
          resultado.contatosCriados++
        }
      }

      resultado.processadas++
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'erro desconhecido'
      if (resultado.erros.length < MAX_ERROS_REPORTADOS) {
        resultado.erros.push(`${formatCnpj(cnpj)}: ${motivo}`)
      }
      console.error('[importador] falha ao aplicar a linha', linha.id, erro)
    }
  }

  // Lote incompleto = acabaram as linhas.
  resultado.concluido = linhas.length < TAMANHO_LOTE

  return resultado
}

/** Quantas linhas resolvidas ainda existem — o denominador da barra de progresso. */
export async function contarResolvidas(
  supabase: ClienteServidor,
  importacaoId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('importacoes_linhas')
    .select('id', { count: 'exact', head: true })
    .eq('importacao_id', importacaoId)
    .eq('status', 'resolvida')

  if (error) throw new Error(error.message)
  return count ?? 0
}
