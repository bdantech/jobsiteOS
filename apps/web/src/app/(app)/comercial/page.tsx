import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'

// A tela lê o funil do usuário logado; renderizar estático congelaria a contagem.
export const dynamic = 'force-dynamic'

/**
 * `/comercial` não é uma tela — é o despacho para o funil de quem entrou.
 *
 * A primeira aba de um vendedor é sempre o funil dele, porque é lá que está a próxima
 * ação. Abrir o módulo num painel de números seria abrir o dia de trabalho pela
 * contabilidade dele: bonito na segunda de manhã, inútil às onze da terça.
 *
 * Redirecionar em vez de renderizar o funil aqui mantém UMA url por funil. Duas rotas
 * pintando a mesma tela deixariam a aba ativa piscando conforme o caminho de entrada.
 */
/*
 * Desde a 04p o despacho é UM só: Meu Dia.
 *
 * Ele existe justamente para ser a primeira tela — a lista do que fazer agora. O funil
 * de cada tipo continua a uma aba de distância, e é para lá que os botões dos cards
 * levam. Abrir no funil era abrir o dia pela contabilidade dele; abrir no Meu Dia é
 * abrir pela próxima ação, que é a razão de a tela existir.
 */
const DESTINO = '/comercial/meu-dia'

export default async function Pagina() {
  const { vendedor, ehGestor } = await contextoComercial()

  if (vendedor?.tipo) redirect(DESTINO)

  // Gestor sem cadastro de vendedor administra o módulo — para ele o painel É a tela
  // inicial, porque o trabalho dele é olhar o trabalho dos outros. Quem não é gestor nem
  // vendedor cadastrado ainda tem a própria comissão, que é a única coisa que existe
  // para ele até alguém completar o cadastro.
  redirect(ehGestor ? '/comercial/painel' : '/comercial/comissoes')
}
