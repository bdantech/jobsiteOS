import {
  lerRespostaJev,
  montarPedidoJev,
  JEV_URL,
  type PerguntaTipada,
} from '../../../../packages/core/src/analise/classificador.js'
import { custoClaudeCentavos, custoJevCentavos } from '../../../../packages/core/src/analise/tipos.js'
import {
  PERGUNTA_MESMA_ENTIDADE,
  resolverVinculo,
  type Candidata,
  type DepsVinculo,
  type EntradaVinculo,
} from '../../../../packages/core/src/analise/vinculacao.js'
import { EVENTO_TIPOS } from '../../../../packages/core/src/constants.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { requisitarJson } from '../net/http.js'
import { emitirEvento } from '../radar/eventos.js'
import { carregarConfigQualidade, segredoQualidade } from './config.js'
import { claudeDisponivel, contadorVazio, desempatarVinculo } from './modelos.js'

/**
 * VINCULAÇÃO DE CONTAS (05C §10) — a fila de "não vinculados" passa pela cascata antes
 * de chegar a uma pessoa. O que resolve vira vínculo pelo MESMO `app_conversa_vincular`
 * da tela (contato criado, threads irmãs, ledger, primeiro contato); o que não resolve
 * fica na fila humana com as candidatas já pontuadas, ordenada por valor potencial.
 *
 * Cada conta é tentada no máximo uma vez por semana: a cascata custa (pouco) e a base
 * não muda tanto de um dia para o outro.
 */

export interface ResultadoVinculacao {
  tentadas: number
  automaticas: number
  humanas: number
  nao_resolviveis: number
  falhas: number
}

const linhaParaCandidata = (r: {
  empresa_id: string
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  dominio: string | null
  uf: string | null
  valor: number | null
}): Candidata => ({ ...r, valor: r.valor === null ? null : Number(r.valor) })

export async function resolverVinculacoes(limite = 100): Promise<ResultadoVinculacao> {
  const res: ResultadoVinculacao = { tentadas: 0, automaticas: 0, humanas: 0, nao_resolviveis: 0, falhas: 0 }
  const cfg = await carregarConfigQualidade()
  if (!cfg.vinculacao.ligada) return res

  const { data: pendentes } = await supabaseAdmin
    .from('conversas_nao_vinculadas')
    .select('id, canal, identificador_externo, nome_sugerido')
    .eq('status', 'pendente')
    .order('ultima_mensagem_em', { ascending: false })
    .limit(limite * 3)
  if (!pendentes?.length) return res

  const semana = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data: recentes } = await supabaseAdmin
    .from('vinculacao_tentativas')
    .select('nao_vinculada_id')
    .in('nao_vinculada_id', pendentes.map((p) => p.id))
    .gt('criada_em', semana)
  const jaTentadas = new Set((recentes ?? []).map((r) => r.nao_vinculada_id))

  const chaveJev = await segredoQualidade('jev_api_key')
  const jev = contadorVazio()
  const claude = contadorVazio()

  const deps: DepsVinculo = {
    cfg: cfg.vinculacao,
    porDominio: async (d) => {
      const { data } = await supabaseAdmin.rpc('app__vinc_candidatas_dominio', { p_dominio: d })
      return (data ?? []).map(linhaParaCandidata)
    },
    porTelefone: async (t) => {
      const { data } = await supabaseAdmin.rpc('app__vinc_candidatas_telefone', { p_digitos: t })
      return (data ?? []).map(linhaParaCandidata)
    },
    buscarParecidas: async (nome, n) => {
      const { data } = await supabaseAdmin.rpc('app__vinc_candidatas_nome', { p_nome: nome, p_limite: n })
      return (data ?? []).map(linhaParaCandidata)
    },
    pontuar: chaveJev
      ? async (e, cs) => {
          // UM pedido com uma pergunta por candidata: o estado é a conta e a lista.
          const perguntas: PerguntaTipada[] = cs.map((c, i) => ({
            id: `c${i}`,
            tipo: 'sim_nao',
            pergunta: `${PERGUNTA_MESMA_ENTIDADE} Empresa: ${c.razao_social ?? '—'}${c.nome_fantasia ? ` (${c.nome_fantasia})` : ''}, domínio ${c.dominio ?? '—'}, ${c.uf ?? '—'}.`,
          }))
          const estado = JSON.stringify({ canal: e.canal, identificador: e.identificador, nome: e.nome_sugerido })
          const corpo = await requisitarJson(JEV_URL, {
            method: 'POST',
            headers: { authorization: `Bearer ${chaveJev}` },
            body: montarPedidoJev(estado, perguntas),
            tentativas: 2,
            timeoutMs: 20_000,
          })
          const lido = lerRespostaJev(perguntas, corpo)
          jev.entrada += lido.tokensEntrada
          return lido.respostas.map((r) => ({ empresa_id: cs[Number(r.id.slice(1))]!.empresa_id, probabilidade: r.probabilidade }))
        }
      : undefined,
    desempatar: claudeDisponivel()
      ? (e, cs) => desempatarVinculo({ canal: e.canal, identificador: e.identificador, nome: e.nome_sugerido }, cs, claude)
      : undefined,
  }

  for (const p of pendentes) {
    if (res.tentadas >= limite) break
    if (jaTentadas.has(p.id)) continue
    res.tentadas++
    const antesJev = jev.entrada
    const antesClaude = { entrada: claude.entrada, saida: claude.saida }
    const entrada: EntradaVinculo = {
      canal: p.canal as 'whatsapp' | 'email',
      identificador: p.identificador_externo,
      nome_sugerido: p.nome_sugerido,
    }
    try {
      const r = await resolverVinculo(entrada, deps)
      const custo =
        custoJevCentavos(jev.entrada - antesJev, cfg.precos) +
        custoClaudeCentavos({ entrada: claude.entrada - antesClaude.entrada, saida: claude.saida - antesClaude.saida }, cfg.precos)

      let aplicada = false
      if (r.empresa_id) {
        const { error } = await supabaseAdmin.rpc('app_conversa_vincular', {
          p: {
            id: p.id,
            empresa_id: r.empresa_id,
            nome: p.nome_sugerido?.trim() || p.identificador_externo,
          } as never,
        })
        if (error) logger.warn({ id: p.id, erro: error.message }, 'Vínculo automático recusado pelo banco.')
        else aplicada = true
      }

      await supabaseAdmin.from('vinculacao_tentativas').insert({
        nao_vinculada_id: p.id,
        etapa: aplicada ? r.etapa : 'humano',
        empresa_id: r.empresa_id,
        probabilidade: r.probabilidade,
        motivo: r.motivo,
        candidatas: r.candidatas.slice(0, 10) as never,
        nao_resolvivel: r.nao_resolvivel,
        aplicada,
        custo_centavos: custo,
      })

      if (aplicada) {
        res.automaticas++
        await emitirEvento(r.empresa_id, EVENTO_TIPOS.VINCULACAO_RESOLVIDA_AUTOMATICAMENTE, {
          resumo: `${p.canal} ${p.identificador_externo} vinculado automaticamente (${r.etapa}): ${r.motivo}`,
          nao_vinculada_id: p.id,
          etapa: r.etapa,
        })
      } else {
        res.humanas++
        if (r.nao_resolvivel) res.nao_resolviveis++
        await emitirEvento(null, EVENTO_TIPOS.VINCULACAO_ENVIADA_PARA_HUMANO, {
          resumo: `${p.canal} ${p.identificador_externo}: ${r.motivo}`,
          nao_vinculada_id: p.id,
          candidatas: r.candidatas.length,
        })
      }
    } catch (erro) {
      res.falhas++
      logger.warn({ id: p.id, erro: String(erro) }, 'Vinculação falhou para uma conta.')
    }
  }
  logger.info(res, 'Vinculação de contas concluída.')
  return res
}
