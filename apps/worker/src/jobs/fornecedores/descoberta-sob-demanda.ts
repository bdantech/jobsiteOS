import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  deveParar,
  planejarDescobertaSobDemanda,
  type EstadoFornecedor,
  type PlanoDescoberta,
} from '../../../../../packages/core/src/fornecedores/cascata.js'
import type { Confianca } from '../../../../../packages/core/src/fornecedores/schemas.js'
import { normalizarTelefoneBr } from '../../../../../packages/core/src/fornecedores/telefone.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'
import { contatosEmpresa } from '../radar/contatos.js'
import {
  lerApolloMinimoFaturamento,
  lerApolloMinimoFuncionarios,
  lerCustos,
  lerPararAoEncontrarAlta,
  lerTtlSobDemanda,
} from './config.js'
import {
  atualizarResumo,
  cadastralDoFornecedor,
  dentroDoTtl,
  gravarContatos,
  registrarExecucao,
} from './descoberta.js'
import { tetoDoOriginador } from './orcamento.js'
import { buscarComClaude } from './provedores/claude-busca.js'
import { buscarNaNovaVida } from './provedores/novavida.js'

/**
 * Camadas 2+4 (§4.2): o CLIQUE do originador. É o único caminho pago por pessoa.
 *
 * ─── O TETO É A AUTORIZAÇÃO ──────────────────────────────────────────────────
 *
 * O originador aciona sozinho, dentro do teto mensal dele. Estourou, precisa de
 * liberação do gestor (`forcar`). Pedir aprovação para cada R$ 1,65 transformaria a
 * descoberta num processo com fila — e uma fila de aprovação de centavos é como um
 * recurso pago vira um recurso que ninguém usa.
 *
 * ─── PARAR NA PRIMEIRA CONFIANÇA ALTA ────────────────────────────────────────
 *
 * O custo mostrado no botão é o TETO do clique. Se a Nova Vida trouxer o celular do
 * sócio com confiança alta, o Apollo e o Claude não rodam e a fatura é menor.
 * Prometer o teto e cobrar menos é a única direção aceitável do erro.
 */

export interface ResultadoClique {
  ok: boolean
  motivo?: string
  plano: PlanoDescoberta
  contatosNovos: number
  custo: number
  parouEm?: string
  orcamento: { gasto: number; teto: number; saldo: number }
}

/** O plano do clique, sem executar nada. É o que a tela mostra ANTES de perguntar. */
export async function planejarClique(cnpj: string): Promise<{
  plano: PlanoDescoberta
  orcamento: Awaited<ReturnType<typeof tetoDoOriginador>>
  originadorId: string | null
}> {
  const [custos, parar, minFunc, minFat] = await Promise.all([
    lerCustos(),
    lerPararAoEncontrarAlta(),
    lerApolloMinimoFuncionarios(),
    lerApolloMinimoFaturamento(),
  ])

  const { data: funil } = await supabaseAdmin
    .from('fornecedores_funil')
    .select('originador_id, melhor_confianca')
    .eq('fornecedor_cnpj', cnpj)
    .maybeSingle()

  const cadastral = await cadastralDoFornecedor(cnpj)

  const estado: EstadoFornecedor = {
    dominio: cadastral.dominio,
    funcionarios: cadastral.funcionarios,
    faturamento_estimado: cadastral.faturamento_estimado,
    municipio: cadastral.municipio,
    uf: cadastral.uf,
    razao_social: cadastral.razao_social,
    melhor_confianca: (funil?.melhor_confianca as Confianca | null) ?? null,
  }

  const plano = planejarDescobertaSobDemanda(estado, {
    custos,
    pararAoEncontrarAlta: parar,
    apolloMinimoFuncionarios: minFunc,
    apolloMinimoFaturamento: minFat,
  })

  return {
    plano,
    orcamento: await tetoDoOriginador(funil?.originador_id ?? null, plano.custo_estimado),
    originadorId: funil?.originador_id ?? null,
  }
}

export async function descobertaSobDemanda(
  cnpj: string,
  opcoes: { solicitadoPor?: string | null; forcar?: boolean } = {},
): Promise<ResultadoClique> {
  const [{ plano, orcamento, originadorId }, custos, parar, ttlDias] = await Promise.all([
    planejarClique(cnpj),
    lerCustos(),
    lerPararAoEncontrarAlta(),
    lerTtlSobDemanda(),
  ])

  const orcResumo = { gasto: orcamento.gasto, teto: orcamento.teto, saldo: orcamento.saldo }

  if (plano.custo_estimado === 0) {
    return {
      ok: false,
      motivo: plano.etapas[0]?.motivo ?? 'Nada a buscar.',
      plano,
      contatosNovos: 0,
      custo: 0,
      orcamento: orcResumo,
    }
  }

  if (!orcamento.cabe && !opcoes.forcar) {
    return {
      ok: false,
      motivo:
        `Este clique custa R$ ${plano.custo_estimado.toFixed(2)} e o saldo do mês é ` +
        `R$ ${orcamento.saldo.toFixed(2)}. Peça liberação ao gestor.`,
      plano,
      contatosNovos: 0,
      custo: 0,
      orcamento: orcResumo,
    }
  }

  const cadastral = await cadastralDoFornecedor(cnpj)
  const { data: funil } = await supabaseAdmin
    .from('fornecedores_funil')
    .select('melhor_confianca, sacados_principais')
    .eq('fornecedor_cnpj', cnpj)
    .maybeSingle()

  let melhor = (funil?.melhor_confianca as Confianca | null) ?? null
  let novos = 0
  let custo = 0
  let parouEm: string | undefined

  const registrar = (
    provedor: 'novavida' | 'apollo' | 'claude_busca',
    status: 'sucesso' | 'sem_dados' | 'erro' | 'pulado',
    extra: { motivo?: string | null; custo?: number; contatosNovos?: number } = {},
  ): Promise<void> =>
    registrarExecucao({
      cnpj,
      camada: 'sob_demanda',
      provedor,
      status,
      originadorId,
      solicitadoPor: opcoes.solicitadoPor ?? null,
      ...extra,
    })

  for (const etapa of plano.etapas) {
    if (!etapa.rodara) {
      await registrar(etapa.provedor as 'novavida' | 'apollo' | 'claude_busca', 'pulado', {
        motivo: etapa.motivo,
      })
      continue
    }

    if (deveParar(melhor, parar)) {
      parouEm = etapa.provedor
      await registrar(etapa.provedor as 'novavida' | 'apollo' | 'claude_busca', 'pulado', {
        motivo: 'A etapa anterior já trouxe contato de confiança alta.',
      })
      continue
    }

    // Não paga duas vezes pela mesma resposta dentro do TTL.
    if (await dentroDoTtl(cnpj, etapa.provedor, ttlDias)) {
      await registrar(etapa.provedor as 'novavida' | 'apollo' | 'claude_busca', 'pulado', {
        motivo: `Consultado há menos de ${ttlDias} dias.`,
      })
      continue
    }

    if (etapa.provedor === 'novavida') {
      const r = await buscarNaNovaVida(cadastral)
      if (!r.disponivel) {
        await registrar('novavida', 'pulado', { motivo: r.erro })
        continue
      }
      custo += custos.novavida
      const g = r.contatos.length ? await gravarContatos(cnpj, r.contatos, 'novavida') : { novos: 0 }
      novos += g.novos
      melhor = melhorDe(melhor, r.contatos.map((c) => c.confianca))
      await registrar('novavida', r.contatos.length ? 'sucesso' : r.erro ? 'erro' : 'sem_dados', {
        motivo: r.erro, custo: custos.novavida, contatosNovos: g.novos,
      })
      continue
    }

    if (etapa.provedor === 'apollo') {
      /*
       * O Apollo é o do RADAR, reusado inteiro (§7: "provedores atrás da mesma
       * interface plugável"). Ele grava direto em `contatos` da empresa e alimenta
       * `enriquecimentos` — que é onde o orçamento do Radar mora. Reimplementá-lo
       * aqui daria duas contabilidades para o mesmo crédito de revelação.
       *
       * Por isso `contatosEmpresa` precisa de uma `empresas.id`: fornecedor que não
       * foi promovido não tem ficha, e este é o único provedor da cascata que exige
       * uma. É registrado como pulado, com o motivo — nunca como falha.
       */
      const { data: emp } = await supabaseAdmin
        .from('empresas')
        .select('id')
        .eq('cnpj', cnpj)
        .maybeSingle()
      if (!emp?.id) {
        await registrar('apollo', 'pulado', {
          motivo: 'O Apollo consulta por ficha de empresa, e este fornecedor ainda não foi promovido.',
        })
        continue
      }
      try {
        // O custo real vem do lote do Radar (`enriquecimentos.custo_real`); o nosso
        // registro guarda o que ele efetivamente cobrou, não a estimativa.
        const r = await contatosEmpresa({ empresaId: emp.id })
        custo += r.custo
        await registrar('apollo', r.processados > 0 ? 'sucesso' : 'sem_dados', {
          custo: r.custo, contatosNovos: r.processados,
        })
        if (r.processados > 0) {
          // Os contatos entraram em `contatos`; espelha na descoberta para que o card
          // e o painel de eficácia os vejam com a fonte certa.
          const espelhados = await espelharContatosDaEmpresa(cnpj, emp.id, cadastral.ddd)
          novos += espelhados
          melhor = melhorDe(melhor, ['media'])
        }
      } catch (e) {
        await registrar('apollo', 'erro', { motivo: String(e) })
      }
      continue
    }

    // claude_busca
    const sacados = Array.isArray(funil?.sacados_principais)
      ? (funil.sacados_principais as { nome: string | null }[])
      : []
    const r = await buscarComClaude(cadastral, sacados)
    if (!r.disponivel) {
      await registrar('claude_busca', 'pulado', { motivo: r.erro })
      continue
    }
    custo += custos.claude_busca
    const g = r.contatos.length ? await gravarContatos(cnpj, r.contatos, 'claude_busca') : { novos: 0 }
    novos += g.novos
    melhor = melhorDe(melhor, r.contatos.map((c) => c.confianca))
    await registrar('claude_busca', r.contatos.length ? 'sucesso' : r.erro ? 'erro' : 'sem_dados', {
      motivo: r.erro, custo: custos.claude_busca, contatosNovos: g.novos,
    })
  }

  const resumo = await atualizarResumo(cnpj, { camada: 'sob_demanda', marcarSemContato: true })

  if (novos > 0) {
    await emitirEvento(null, EVENTO_TIPOS.FORNECEDOR_CONTATOS_ENCONTRADOS, {
      titulo: 'Contatos do fornecedor encontrados',
      resumo: `${novos} contato(s) novo(s) para ${cnpj}. Melhor confiança: ${resumo.melhor ?? '—'}.`,
      url: '/comercial/fornecedores',
      cnpj,
      novos,
      custo,
    })
  }

  logger.info({ cnpj, novos, custo, parouEm }, 'Descoberta sob demanda concluída.')
  return {
    ok: true,
    plano,
    contatosNovos: novos,
    custo,
    ...(parouEm ? { parouEm } : {}),
    orcamento: orcResumo,
  }
}

function melhorDe(atual: Confianca | null, novas: readonly Confianca[]): Confianca | null {
  const peso = { alta: 3, media: 2, baixa: 1 } as const
  let melhor = atual
  for (const c of novas) {
    if (!melhor || peso[c] > peso[melhor]) melhor = c
  }
  return melhor
}

/** Traz para `contatos_descobertos` o que o Apollo gravou em `contatos`. */
async function espelharContatosDaEmpresa(
  cnpj: string,
  empresaId: string,
  ddd: string | null,
): Promise<number> {
  const { data } = await supabaseAdmin
    .from('contatos')
    .select('nome, cargo, email, telefone, whatsapp')
    .eq('empresa_id', empresaId)
    .limit(50)

  const linhas = []
  for (const c of data ?? []) {
    if (c.email) {
      linhas.push({
        tipo: 'email', valor: c.email.trim().toLowerCase(), original: c.email,
        nome_pessoa: c.nome, cargo: c.cargo, confianca: 'media' as const,
        evidencia: 'Apollo (via ficha da empresa)',
      })
    }
    for (const [tipo, bruto] of [['telefone', c.telefone], ['whatsapp', c.whatsapp]] as const) {
      if (!bruto) continue
      const tel = normalizarTelefoneBr(bruto, { dddPadrao: ddd })
      if (!tel.e164) continue
      linhas.push({
        tipo, valor: tel.e164, original: bruto, nome_pessoa: c.nome, cargo: c.cargo,
        confianca: 'media' as const, evidencia: 'Apollo (via ficha da empresa)',
      })
    }
  }
  if (linhas.length === 0) return 0
  const r = await gravarContatos(cnpj, linhas, 'apollo')
  return r.novos
}
