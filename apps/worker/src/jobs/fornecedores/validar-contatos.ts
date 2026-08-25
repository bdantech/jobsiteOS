import dns from 'node:dns/promises'
import { normalizarTelefoneBr } from '../../../../../packages/core/src/fornecedores/telefone.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { todasAsPaginas } from '../../paginar.js'
import { atualizarResumo } from './descoberta.js'

/**
 * Validação (§4.4), diária, sobre qualquer fonte.
 *
 * ─── CONTATO INVÁLIDO NÃO É APAGADO ──────────────────────────────────────────
 *
 * Ele fica com a confiança REBAIXADA e marcado em `validado`. Apagar destruiria
 * justamente a evidência de que uma fonte entrega lixo — e é essa evidência que o
 * painel de eficácia (§6) usa para decidir desligar um provedor. Um provedor com 200
 * contatos e 5% de validade some do relatório se as 190 linhas ruins forem deletadas.
 *
 * ─── O QUE DÁ PARA TESTAR SEM TOCAR NO CANAL ─────────────────────────────────
 *
 * Telefone: forma canônica e DDD existente (a normalização já é o teste).
 * E-mail: sintaxe e REGISTRO MX do domínio — se o domínio não aceita e-mail, o
 *   endereço não recebe, e isso se sabe sem mandar nada.
 *
 * Nada aqui envia mensagem, disca ou faz probe de caixa postal. Verificação por
 * envio é toque, e toque passa pela supressão e por uma pessoa.
 */

interface Linha {
  id: string
  fornecedor_cnpj: string
  tipo: string
  valor: string
  confianca: string
  validado: unknown
}

const CACHE_MX = new Map<string, boolean>()

async function temMx(dominio: string): Promise<boolean> {
  const cache = CACHE_MX.get(dominio)
  if (cache !== undefined) return cache
  let ok = false
  try {
    ok = (await dns.resolveMx(dominio)).length > 0
  } catch {
    ok = false
  }
  CACHE_MX.set(dominio, ok)
  return ok
}

export interface ResultadoValidacao {
  testados: number
  validos: number
  rebaixados: number
}

export async function validarContatosJob(limite = 2000): Promise<ResultadoValidacao> {
  /*
   * Prioriza o que NUNCA foi validado (`validado = '{}'`), que é o que o índice
   * parcial cobre. Revalidar tudo todo dia seria milhares de consultas de DNS para
   * confirmar o que já se sabe — e o MX de um domínio não muda de um dia para o outro.
   */
  const linhas = await todasAsPaginas<Linha>((de, ate) =>
    supabaseAdmin
      .from('contatos_descobertos')
      .select('id, fornecedor_cnpj, tipo, valor, confianca, validado')
      .eq('validado', '{}')
      .order('descoberto_em', { ascending: true })
      .range(de, Math.min(ate, de + limite - 1)),
  )

  let validos = 0
  let rebaixados = 0
  const afetados = new Set<string>()

  for (const l of linhas.slice(0, limite)) {
    let valido = true
    let motivo: string | null = null
    const extra: Record<string, unknown> = {}

    if (l.tipo === 'telefone' || l.tipo === 'whatsapp') {
      const tel = normalizarTelefoneBr(l.valor)
      valido = tel.valido
      motivo = tel.motivo
      extra.tipo_linha = tel.tipo
      // Palpite, e o nome diz. A confirmação de verdade viria de um provedor de
      // WhatsApp, que ainda não temos — e prometer WhatsApp num fixo faz o
      // originador perder o toque.
      extra.tem_whatsapp = tel.valido && tel.tipo === 'movel'
      extra.nono_digito_inferido = tel.nono_digito_inferido
    } else if (l.tipo === 'email') {
      const partes = l.valor.split('@')
      const dominio = partes[1] ?? ''
      if (partes.length !== 2 || !dominio) {
        valido = false
        motivo = 'sintaxe'
      } else {
        const mx = await temMx(dominio)
        extra.mx_valido = mx
        valido = mx
        motivo = mx ? null : 'sem_mx'
      }
    } else {
      // Site e Instagram não têm teste barato que valha a pena: um HEAD por linha
      // custaria mais do que a informação vale, e a evidência já traz a URL.
      extra.nao_testavel = true
    }

    const validado = {
      ...(typeof l.validado === 'object' && l.validado !== null ? l.validado : {}),
      ...extra,
      valido,
      motivo,
      verificado_em: new Date().toISOString(),
    }

    const campos: Record<string, unknown> = { validado }
    if (!valido && l.confianca !== 'baixa') {
      campos.confianca = 'baixa'
      rebaixados += 1
    }
    if (valido) validos += 1

    await supabaseAdmin.from('contatos_descobertos').update(campos).eq('id', l.id)
    afetados.add(l.fornecedor_cnpj)
  }

  // A melhor confiança do card muda quando um contato é rebaixado — e é ela que
  // decide se o botão de busca paga vai dizer "já temos alta" na próxima abertura.
  for (const cnpj of afetados) {
    try {
      await atualizarResumo(cnpj)
    } catch (e) {
      logger.error({ cnpj, erro: String(e) }, 'Falha ao atualizar resumo após validação.')
    }
  }

  logger.info({ testados: Math.min(linhas.length, limite), validos, rebaixados }, 'Validação de contatos concluída.')
  return { testados: Math.min(linhas.length, limite), validos, rebaixados }
}
