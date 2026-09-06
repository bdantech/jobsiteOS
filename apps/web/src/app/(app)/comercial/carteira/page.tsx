import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { CarteiraVendedor } from '@/components/comercial/carteira-vendedor'

export const metadata: Metadata = { title: 'Carteira' }

// O volume do mês muda a cada antecipação convertida; estático serviria número velho.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor, vendedor } = await contextoComercial()

  /*
   * O auxiliar abre na carteira do CLOSER dele, não na própria — que é vazia por
   * definição, já que quem titulariza conta é o closer. Abrir numa tela vazia e esperar
   * que ele descubra o seletor seria ensiná-lo que a carteira do time não é com ele.
   *
   * Continua sendo só o ponto de partida: o seletor está lá, e a RLS decide o que ele
   * consegue abrir de fato.
   */
  const inicial = vendedor?.tipo === 'auxiliar' ? vendedor.superior_id : null
  return <CarteiraVendedor ehGestor={ehGestor} vendedorInicial={inicial} />
}
