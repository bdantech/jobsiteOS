import type { Metadata } from 'next'
import { listarCrons } from '@jobsiteos/core'
import { CronsLista } from '@/components/admin/crons-lista'
import vercel from '../../../../../vercel.json'

export const metadata: Metadata = { title: 'Crons' }

// A tela mostra a PRÓXIMA execução, calculada a partir de agora. Renderizada
// estaticamente, ela congelaria no horário do build e envelheceria em silêncio.
export const dynamic = 'force-dynamic'

/**
 * A agenda vem de `apps/web/vercel.json`, importado aqui de propósito.
 *
 * É o mesmo arquivo que a Vercel lê para disparar — então a tela não pode discordar
 * do que roda de verdade. A alternativa (uma lista de horários no código) teria dois
 * donos e, no dia em que divergissem, esta página mostraria com toda a confiança um
 * horário em que nada acontece. O catálogo em packages/core acrescenta só o que o
 * vercel.json não sabe: o nome, o módulo e o porquê.
 *
 * O guard é o layout de /admin (admin-only) — esta página não lê nada do banco.
 */
export default async function CronsPage() {
  const agora = new Date()
  const crons = listarCrons(vercel.crons, agora)

  return <CronsLista crons={crons} agora={agora} />
}
