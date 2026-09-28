import type { Metadata } from 'next'
import { listarCrons, type ExecucaoCron, type StatusExecucaoCron } from '@jobsiteos/core'
import { CronsLista } from '@/components/admin/crons-lista'
import { createClient } from '@/lib/supabase/server'
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
 * O guard é o layout de /admin (admin-only). Do banco vem só a última execução de cada
 * rotina (`cron_execucoes_ultimas`, 0272), pela sessão do usuário: a RLS da tabela é
 * só de admin, então a view respeita o mesmo guard por conta própria.
 */
export default async function CronsPage() {
  const agora = new Date()
  const crons = listarCrons(vercel.crons, agora)

  const supabase = await createClient()
  const { data } = await supabase
    .from('cron_execucoes_ultimas')
    .select('path, status, iniciado_em, terminado_em, esperado_em, acompanhado, erro')

  // A view devolve tudo como anulável; `path` e `iniciado_em` nunca são nulos na tabela.
  const ultimas: ExecucaoCron[] = (data ?? []).flatMap((u) =>
    u.path && u.iniciado_em && u.status
      ? [
          {
            path: u.path,
            status: u.status as StatusExecucaoCron,
            iniciado_em: u.iniciado_em,
            terminado_em: u.terminado_em,
            esperado_em: u.esperado_em,
            acompanhado: u.acompanhado ?? false,
            erro: u.erro,
          },
        ]
      : [],
  )

  return <CronsLista crons={crons} ultimas={ultimas} agora={agora} />
}
