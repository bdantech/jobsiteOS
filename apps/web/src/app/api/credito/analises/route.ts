import { NextResponse } from 'next/server'
import { MutationError, solicitarAnalise } from '@jobsiteos/core'

import { varrerAgora } from '@/lib/notificacoes.server'
import { createBearerClient, jsonError, readJsonBody, requireApiSession } from '../../_lib/session'

/**
 * Pedir análise de crédito a partir do MOBILE.
 *
 * ── POR QUE ISTO EXISTE, SE O RPC JÁ ERA CHAMÁVEL DO APP ────────────────────
 * O app chamava `app_solicitar_analise` direto no Postgres, e funcionava: o RPC valida,
 * grava, emite o evento, e o gatilho de fan-out toca o sino de quem tem o perfil Crédito.
 *
 * O que não acontecia era o PUSH. Ele não sai de dentro do banco — não há chave VAPID nem
 * cliente Expo lá — e um pedido aberto no celular do vendedor, no cliente, é justamente o
 * que o analista precisa receber no bolso, não na próxima vez que abrir a esteira.
 *
 * Então o caminho do app passa a ser o mesmo dos outros: grava pelo RPC com o token de
 * QUEM PEDIU (o RPC exige `auth.uid()` e o módulo — a autorização continua sendo do banco,
 * não desta rota) e, gravado, manda o push.
 *
 * ── O QUE ESTA ROTA NÃO FAZ ─────────────────────────────────────────────────
 * Não usa o service role para escrever. Se usasse, `auth.uid()` viria nulo, o RPC recusaria
 * — e "resolver" isso passando o id por parâmetro trocaria a autorização do banco por uma
 * confiança nesta rota. O `admin` só aparece dentro de `avisarPedidoDeAnalise`, para ler
 * quem é analista e mandar o push.
 */

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiSession(request)
  if (!auth.ok) return auth.response

  const { usuario, accessToken } = auth.session

  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) return parsedBody.response

  const scoped = createBearerClient(accessToken)

  try {
    // O schema do core valida; o RPC decide se pode. Esta rota não repete nenhum dos dois.
    const analise = await solicitarAnalise(scoped, parsedBody.body)

    // O aviso ao Crédito sai do evento `analise.solicitada` que o RPC gravou (0262);
    // aqui só se entrega o push já, sem esperar a varredura.
    await varrerAgora()

    return NextResponse.json({ analise }, { status: 201 })
  } catch (e) {
    /*
     * "Já existe uma análise em andamento" é o erro mais comum aqui, e é uma recusa do
     * RPC — 409, não 500. O texto vem de lá porque é ele que sabe o motivo, e reescrevê-lo
     * aqui criaria duas versões da mesma regra.
     */
    if (e instanceof MutationError) {
      return jsonError(e.message, e.code === 'forbidden' ? 403 : 409)
    }
    return jsonError('Não foi possível solicitar a análise.', 500)
  }
}
