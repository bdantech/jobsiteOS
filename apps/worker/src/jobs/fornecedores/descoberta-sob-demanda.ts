import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  deveParar,
  lacunasDeContato,
  planejarDescobertaSobDemanda,
  type EstadoFornecedor,
  type LacunasDeContato,
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
  gravarCadastralDescoberto,
  gravarContatos,
  gravarDominioDescoberto,
  registrarExecucao,
} from './descoberta.js'
import { tetoDoOriginador } from './orcamento.js'
import { buscarComClaude, buscarComClaudeAprofundado } from './provedores/claude-busca.js'
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
    porte_rfb: cadastral.porte_rfb,
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

  /*
   * O domínio é ESTADO DA CORRIDA, não constante.
   *
   * A busca do Claude é quem o descobre, e o Apollo é quem precisa dele. Lendo o
   * cadastral uma vez no início, o Apollo enxergaria sempre o valor de antes da busca
   * — que foi exatamente o que aconteceu com a I3M: pulou por "sem domínio" treze
   * segundos antes de `i3m.com.br` aparecer.
   */
  let dominioAtual = cadastral.dominio

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

      /*
       * O cadastral que veio junto é gravado na ficha — e é ele que pode destravar o
       * Apollo mais adiante NESTA MESMA corrida, porque o gate de porte lê exatamente
       * `funcionarios`. Pagar pela consulta e descartar essa metade seria comprar a
       * resposta e jogar fora a que resolve o problema seguinte.
       */
      if (r.cadastrais) await gravarCadastralDescoberto(cnpj, r.cadastrais)
      await registrar('novavida', r.contatos.length ? 'sucesso' : r.erro ? 'erro' : 'sem_dados', {
        // A forma da resposta entra no `motivo` do registro: é o que permite
        // diagnosticar um `sem_dados` de R$ 0,35 sem repetir a consulta.
        motivo: r.erro ?? r.forma ?? null,
        custo: custos.novavida,
        contatosNovos: g.novos,
      })
      continue
    }

    if (etapa.provedor === 'apollo') {
      if (!dominioAtual) {
        await registrar('apollo', 'pulado', {
          motivo: 'Nem o cadastro nem a busca acharam um domínio — o Apollo consulta por domínio.',
        })
        continue
      }
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

    /*
     * O site achado vira DOMÍNIO, e não só mais uma linha de contato.
     *
     * É o que destrava o Apollo — que roda logo depois nesta ordem — e o que faz a
     * próxima cascata do Radar não precisar descobri-lo de novo. Um domínio guardado
     * como "contato do tipo site" serve para clicar e para mais nada.
     */
    if (!dominioAtual) {
      const site = r.contatos.find((c) => c.tipo === 'site')
      if (site && (await gravarDominioDescoberto(cnpj, site.valor, site.evidencia))) {
        dominioAtual = site.valor
      }
    }
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

/**
 * A SEGUNDA busca (§4.2c aprofundada), fora da cascata.
 *
 * Ela não entra no plano das camadas 2+4 de propósito: só faz sentido DEPOIS de a
 * primeira ter rodado e voltado com pouco, e pô-la no plano faria a estimativa do
 * primeiro clique somar um custo que ninguém ia pagar naquele momento.
 *
 * ─── O TTL NÃO SE APLICA, E ISSO É DELIBERADO ────────────────────────────────
 *
 * `claude_busca` tem TTL de 90 dias — não se paga duas vezes pela mesma pergunta. Mas
 * esta é OUTRA pergunta: ela carrega o que já foi achado e o que falhou. O TTL dela é
 * o dela, sobre `claude_aprofundado`.
 *
 * ─── ELA RECUSA QUANDO NÃO HÁ LACUNA ─────────────────────────────────────────
 *
 * Com uma pessoa nomeada e canal direto validado, gastar R$ 0,25 confirmaria o que
 * está na tela. É a mesma disciplina do `parar_ao_encontrar_alta`: o clique que não
 * acrescenta nada é recusado com o motivo, não aceito em silêncio.
 */
export async function descobertaAprofundada(
  cnpj: string,
  opcoes: { solicitadoPor?: string | null; forcar?: boolean } = {},
): Promise<ResultadoClique> {
  const [custos, ttlDias] = await Promise.all([lerCustos(), lerTtlSobDemanda()])
  const custoPrevisto = custos.claude_aprofundado ?? 0.25

  const { data: funil } = await supabaseAdmin
    .from('fornecedores_funil')
    .select('originador_id, sacados_principais')
    .eq('fornecedor_cnpj', cnpj)
    .maybeSingle()

  const originadorId = funil?.originador_id ?? null
  const orcamento = await tetoDoOriginador(originadorId, custoPrevisto)
  const orcResumo = { gasto: orcamento.gasto, teto: orcamento.teto, saldo: orcamento.saldo }
  const planoVazio: PlanoDescoberta = {
    etapas: [],
    custo_estimado: custoPrevisto,
    pode_custar_menos: false,
    apollo_depende_da_busca: false,
  }

  const { data: existentes } = await supabaseAdmin
    .from('contatos_descobertos')
    .select('tipo, valor, confianca, nome_pessoa, validado')
    .eq('fornecedor_cnpj', cnpj)

  /*
   * O portão é TER O QUE APROFUNDAR, e não ter havido um clique pago antes.
   *
   * Ele checava `fornecedores_funil.ultima_busca_em`, que só é gravado pela camada
   * sob demanda — 515 dos 520 fornecedores com contato descoberto tinham a coluna
   * nula, porque quem os achou foi a varredura noturna de graça. O botão "Buscar
   * Mais" ficava escondido, e a rota respondia "rode a busca normal primeiro" para
   * quem já tinha uma tela cheia de contatos.
   *
   * O que a busca aprofundada precisa é do material que ela lê — o que já foi
   * achado e o que falhou. A pergunta certa é sobre os CONTATOS, e ela vale igual
   * para o fornecedor que nem linha no funil de cadastro tem, que é o caso de
   * quem chegou pelo card da NF.
   */
  if ((existentes ?? []).length === 0) {
    return {
      ok: false,
      motivo: 'Ainda não há nada achado para aprofundar — rode a busca normal primeiro.',
      plano: planoVazio,
      contatosNovos: 0,
      custo: 0,
      orcamento: orcResumo,
    }
  }

  const lacunas: LacunasDeContato = lacunasDeContato(
    (existentes ?? []).map((c) => ({
      tipo: c.tipo,
      valor: c.valor,
      confianca: c.confianca as Confianca,
      nome_pessoa: c.nome_pessoa,
      valido:
        typeof c.validado === 'object' && c.validado !== null
          ? ((c.validado as Record<string, unknown>).valido as boolean | undefined) ?? null
          : null,
    })),
  )

  if (!lacunas.vale_aprofundar) {
    return {
      ok: false,
      motivo: 'Já há uma pessoa com canal direto validado — a busca aprofundada não acrescentaria.',
      plano: planoVazio,
      contatosNovos: 0,
      custo: 0,
      orcamento: orcResumo,
    }
  }

  if (await dentroDoTtl(cnpj, 'claude_aprofundado', ttlDias)) {
    return {
      ok: false,
      motivo: `A busca aprofundada já rodou há menos de ${ttlDias} dias para este fornecedor.`,
      plano: planoVazio,
      contatosNovos: 0,
      custo: 0,
      orcamento: orcResumo,
    }
  }

  if (!orcamento.cabe && !opcoes.forcar) {
    return {
      ok: false,
      motivo:
        `Esta busca custa R$ ${custoPrevisto.toFixed(2)} e o saldo do mês é ` +
        `R$ ${orcamento.saldo.toFixed(2)}. Peça liberação ao gestor.`,
      plano: planoVazio,
      contatosNovos: 0,
      custo: 0,
      orcamento: orcResumo,
    }
  }

  const cadastral = await cadastralDoFornecedor(cnpj)
  // `funil` pode ser nulo: quem chegou pelo card da NF não tem linha no funil de
  // cadastro. Os sacados só enriquecem o prompt da busca — a ausência deles a
  // deixa mais pobre, nunca inválida.
  const sacados = Array.isArray(funil?.sacados_principais)
    ? (funil.sacados_principais as { nome: string | null }[])
    : []

  const r = await buscarComClaudeAprofundado(cadastral, lacunas, sacados)
  if (!r.disponivel) {
    await registrarExecucao({
      cnpj, camada: 'sob_demanda', provedor: 'claude_aprofundado', status: 'pulado',
      motivo: r.erro ?? null, originadorId, solicitadoPor: opcoes.solicitadoPor ?? null,
    })
    return {
      ok: false, motivo: r.erro ?? 'Provedor indisponível.', plano: planoVazio,
      contatosNovos: 0, custo: 0, orcamento: orcResumo,
    }
  }

  const g = r.contatos.length
    ? await gravarContatos(cnpj, r.contatos, 'claude_aprofundado')
    : { novos: 0 }

  // O site achado aqui também vira domínio — pelo mesmo motivo da primeira passada.
  if (!cadastral.dominio) {
    const site = r.contatos.find((c) => c.tipo === 'site')
    if (site) await gravarDominioDescoberto(cnpj, site.valor, site.evidencia)
  }

  await registrarExecucao({
    cnpj,
    camada: 'sob_demanda',
    provedor: 'claude_aprofundado',
    status: r.contatos.length ? 'sucesso' : r.erro ? 'erro' : 'sem_dados',
    // A lacuna pedida entra no registro: sem ela, "sem_dados" não diz se a busca
    // falhou ou se a pergunta era impossível.
    motivo: r.erro ?? `Procurava: ${lacunas.faltam.join(', ')}.`,
    custo: custoPrevisto,
    contatosNovos: g.novos,
    originadorId,
    solicitadoPor: opcoes.solicitadoPor ?? null,
  })

  const resumo = await atualizarResumo(cnpj, { camada: 'sob_demanda' })
  if (g.novos > 0) {
    await emitirEvento(null, EVENTO_TIPOS.FORNECEDOR_CONTATOS_ENCONTRADOS, {
      titulo: 'Contatos do fornecedor encontrados',
      resumo: `${g.novos} contato(s) novo(s) para ${cnpj} na busca aprofundada. Melhor confiança: ${resumo.melhor ?? '—'}.`,
      url: '/comercial/fornecedores',
      cnpj,
      novos: g.novos,
      custo: custoPrevisto,
    })
  }

  logger.info({ cnpj, novos: g.novos, lacunas: lacunas.faltam }, 'Busca aprofundada concluída.')
  return {
    ok: true,
    plano: planoVazio,
    contatosNovos: g.novos,
    custo: custoPrevisto,
    orcamento: orcResumo,
  }
}
