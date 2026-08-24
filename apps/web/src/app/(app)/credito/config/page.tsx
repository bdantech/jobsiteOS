import type { Metadata } from 'next'
import vercel from '../../../../../vercel.json'
import { CreditoConfig } from '@/components/credito/credito-config'

export const metadata: Metadata = { title: 'Configurações — Crédito' }

/**
 * A lista de crons sai do `vercel.json` de VERDADE, importado aqui.
 *
 * Uma cópia escrita à mão na tela envelheceria em silêncio: alguém muda o horário no
 * arquivo, a tela segue dizendo o antigo, e a próxima pessoa a investigar "por que a
 * decisão só apareceu de manhã" investiga contra um horário que não existe mais. Como o
 * import é resolvido no build, a tela não tem como divergir da configuração.
 *
 * O recorte é por prefixo `credito-`: os crons de outros módulos existem e não são assunto
 * desta tela.
 */
const CRONS = (vercel.crons ?? [])
  .filter((c) => c.path.includes('/cron/credito'))
  .map((c) => ({ path: c.path, schedule: c.schedule }))

export default function CreditoConfigPage() {
  return <CreditoConfig crons={CRONS} />
}
