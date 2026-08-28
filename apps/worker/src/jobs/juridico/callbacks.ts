import { formatarCnj } from '../../../../../packages/core/src/juridico/schemas.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { lerBenchmarkFases, lerNossosCnpjs, lerRegrasFase } from '../../juridico/config.js'
import { capaDoProcesso, movimentacoesDoProcesso } from '../../juridico/escavador.js'
import { notificarGestores } from './notificar.js'
import { persistirProcesso } from './persistir.js'

/**
 * Callbacks do Escavador (08 §3).
 *
 * ── DUAS ETAPAS, E A SEPARAÇÃO É O PONTO ───────────────────────────────────
 * A rota HTTP (apps/web /api/webhooks/escavador) só VALIDA e GRAVA a linha em
 * `juridico_callbacks`, e responde 200 em milissegundos. Este job é quem processa.
 *
 * O Escavador reenvia até 11 vezes com backoff quando não recebe 200. Se a rota
 * fizesse o trabalho inteiro — buscar a capa, paginar as movimentações, classificar
 * as fases — ela levaria dezenas de segundos, o Escavador desistiria da entrega, e
 * ele reenviaria o MESMO callback enquanto o primeiro ainda estivesse rodando.
 *
 * ── A IDEMPOTÊNCIA É A CHAVE PRIMÁRIA, NÃO UM `if` ─────────────────────────
 * `juridico_callbacks.uuid` é PK. O reenvio bate na chave e não vira linha nova —
 * antes de qualquer decisão, e sem que ninguém precise lembrar de checar.
 */

interface PayloadCallback {
  uuid?: string
  event?: string
  evento?: string
  numero_cnj?: string
  processo?: { numero_cnj?: string }
  [k: string]: unknown
}

/** O que a rota HTTP faz. Sem rede, sem Escavador: só grava. */
export async function registrarCallback(
  corpo: unknown,
): Promise<{ aceito: boolean; duplicado: boolean; uuid: string | null }> {
  const p = (corpo ?? {}) as PayloadCallback
  const uuid = typeof p.uuid === 'string' && p.uuid.length > 0 ? p.uuid : null
  if (!uuid) return { aceito: false, duplicado: false, uuid: null }

  const evento = p.event ?? p.evento ?? 'desconhecido'
  const cnjBruto = p.numero_cnj ?? p.processo?.numero_cnj ?? null

  const { error } = await supabaseAdmin.from('juridico_callbacks').insert({
    uuid,
    evento,
    numero_cnj: cnjBruto ? formatarCnj(cnjBruto) : null,
    payload: p as never,
  })

  // 23505 = já recebemos este uuid. É o caso NORMAL do reenvio, e a resposta certa
  // continua sendo 200: um erro faria o Escavador reenviar de novo, para sempre.
  if (error) {
    if (error.code === '23505') return { aceito: true, duplicado: true, uuid }
    throw new Error(error.message)
  }

  return { aceito: true, duplicado: false, uuid }
}

export interface ResultadoCallbacks {
  processados: number
  novos_processos: number
  resyncs: number
  ignorados: number
  creditos: number
  erros: { uuid: string; erro: string }[]
}

export async function processarCallbacks(limite = 50): Promise<ResultadoCallbacks> {
  const r: ResultadoCallbacks = {
    processados: 0,
    novos_processos: 0,
    resyncs: 0,
    ignorados: 0,
    creditos: 0,
    erros: [],
  }

  const { data: pendentes } = await supabaseAdmin
    .from('juridico_callbacks')
    .select('uuid, evento, numero_cnj, payload')
    .is('processado_em', null)
    .order('recebido_em')
    .limit(limite)

  if (!pendentes?.length) return r

  const [regras, benchmark, nossos] = await Promise.all([
    lerRegrasFase(),
    lerBenchmarkFases(),
    lerNossosCnpjs(),
  ])
  const nossosCnpjs = nossos.map((c) => c.cnpj)

  for (const cb of pendentes) {
    try {
      const trataveis = ['novo_processo', 'atualizacao_processo_concluida']
      if (!trataveis.includes(cb.evento) || !cb.numero_cnj) {
        // Evento que não tratamos NÃO é erro: o Escavador manda mais tipos do que
        // usamos. Marcar como processado é o que impede a fila de crescer para
        // sempre com linhas que ninguém vai olhar.
        r.ignorados++
        await supabaseAdmin
          .from('juridico_callbacks')
          .update({ processado_em: new Date().toISOString() })
          .eq('uuid', cb.uuid)
        continue
      }

      const capa = await capaDoProcesso(cb.numero_cnj)
      r.creditos += capa.creditos
      if (!capa.processo) {
        await supabaseAdmin
          .from('juridico_callbacks')
          .update({ processado_em: new Date().toISOString(), erro: 'Processo não devolvido pela API.' })
          .eq('uuid', cb.uuid)
        continue
      }

      const movs = await movimentacoesDoProcesso(cb.numero_cnj)
      r.creditos += movs.creditos

      const p = await persistirProcesso(capa.processo, {
        nossosCnpjs,
        regras,
        benchmark,
        movimentacoes: movs.movimentacoes,
        origem: cb.evento === 'novo_processo' ? 'callback' : 'sincronizacao',
      })

      if (p?.novo && cb.evento === 'novo_processo') {
        r.novos_processos++
        /*
         * Novo processo detectado vai para gestores + jurídico COM push. É a única
         * notícia deste módulo que não é sobre trabalho em andamento: alguém abriu
         * uma ação e ninguém aqui sabia. Descobrir isso na sincronização semanal é
         * descobrir tarde.
         */
        await notificarGestores({
          titulo: 'Novo processo contra nós',
          corpo: `${p.numero_cnj}${capa.processo.titulo_polo_ativo ? ` · ${capa.processo.titulo_polo_ativo}` : ''}`,
          url: `/juridico/${p.numero_cnj}`,
        })
      } else {
        r.resyncs++
      }

      r.processados++
      await supabaseAdmin
        .from('juridico_callbacks')
        .update({ processado_em: new Date().toISOString() })
        .eq('uuid', cb.uuid)
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      logger.error({ uuid: cb.uuid, erro }, 'Falha ao processar callback do Escavador.')
      r.erros.push({ uuid: cb.uuid, erro })
      /*
       * O ERRO É GRAVADO E A LINHA CONTINUA PENDENTE, de propósito. A próxima rodada
       * tenta de novo: uma falha de rede não pode fazer perder um processo novo. O
       * campo `erro` é o que mostra, na tela de configurações, que a fila está
       * batendo na parede em vez de estar vazia por não ter nada.
       */
      await supabaseAdmin.from('juridico_callbacks').update({ erro }).eq('uuid', cb.uuid)
    }
  }

  logger.info(r, 'Callbacks do Escavador processados.')
  return r
}
