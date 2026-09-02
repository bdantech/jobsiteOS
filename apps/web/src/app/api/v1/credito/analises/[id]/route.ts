import { NextResponse } from 'next/server'
import { z } from 'zod'
import { montarPayloadCredito } from '@jobsiteos/core/server/credito-api'
import { createAdminClient } from '@/lib/supabase/admin'
import { autenticar, erroApi, registrarRequisicao } from '../../../_lib/api-key'

/**
 * `GET /api/v1/credito/analises/{id}` (§2.3).
 *
 * Devolve exatamente o payload do webhook, montado pelo MESMO construtor. É o
 * caminho de reconciliação: quem perdeu um webhook não precisa de um formato
 * diferente para se reconciliar, precisa do mesmo objeto.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const uuid = z.string().uuid()
const ROTA = 'GET /api/v1/credito/analises/{id}'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const inicio = Date.now()
  const auth = await autenticar(request, 'credito:read')
  if (!auth.ok) {
    await registrarRequisicao({ keyId: null, rota: ROTA, metodo: 'GET', status: auth.falha.status, duracaoMs: Date.now() - inicio })
    return erroApi(auth.falha)
  }

  const { id } = await params
  const fim = async (status: number): Promise<void> => {
    await registrarRequisicao({ keyId: auth.ctx.keyId, rota: ROTA, metodo: 'GET', status, duracaoMs: Date.now() - inicio })
  }

  // Id malformado é 400 e não consulta: o PostgREST responderia 22P02, que
  // chegaria ao integrador como um 500 sem explicação.
  if (!uuid.safeParse(id).success) {
    await fim(400)
    return erroApi({ status: 400, codigo: 'id_invalido', mensagem: 'O id da análise precisa ser um UUID.' })
  }

  const payload = await montarPayloadCredito(createAdminClient(), id, {
    evento: 'credito.estagio_alterado',
    eventoId: crypto.randomUUID(),
  })

  if (!payload) {
    await fim(404)
    return erroApi({ status: 404, codigo: 'nao_encontrada', mensagem: 'Análise não encontrada.' })
  }

  await fim(200)
  return NextResponse.json(payload)
}
