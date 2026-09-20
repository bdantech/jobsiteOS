import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { SacadosPorNf } from '@/components/antecipacao/sacados-por-nf'

export const metadata: Metadata = { title: 'Sacados por NF — Antecipação' }

/**
 * Sacados por NF (04r) — a aba que ABSORVE e substitui "Sacados a Prospectar".
 *
 * A antiga listava todo CNPJ de construção que já tinha recebido uma nota: uma tabela
 * ordenada por valor, sem dono, sem estágio e sem ação. Esta faz a pergunta que importa
 * — conseguimos OPERAR isto? — e traz o que responde: quem emitiu, quanto sobrevive à
 * esteira, com que recorrência, e o que fazer a seguir.
 *
 * `ehGestor` é resolvido no SERVIDOR: reatribuir card e trocar de originador no seletor
 * são decisões de distribuição. A autorização de verdade continua nas RPCs e na RLS —
 * isto aqui só evita oferecer um botão que o banco vai recusar.
 */
export default async function SacadosPorNfPage() {
  const { ehGestor } = await contextoComercial()
  return <SacadosPorNf ehGestor={ehGestor} />
}
