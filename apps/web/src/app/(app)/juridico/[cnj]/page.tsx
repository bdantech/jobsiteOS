import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CNJ_REGEX, formatarCnj } from '@jobsiteos/core'
import { ProcessoDetalhe } from '@/components/juridico/processo-detalhe'

/**
 * O título da página É o número do processo.
 *
 * A barra de abas do app segue o `<title>` de quem está aberto (components/shell/
 * route-sync.tsx). Com um título fixo, três processos abertos viravam três abas
 * escritas "Processo" — e escolher entre elas seria tentativa e erro. O CNJ é o que o
 * advogado reconhece de relance.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ cnj: string }>
}): Promise<Metadata> {
  const { cnj } = await params
  return { title: formatarCnj(decodeURIComponent(cnj)) }
}

export default async function ProcessoPage({ params }: { params: Promise<{ cnj: string }> }) {
  const { cnj } = await params
  const numero = formatarCnj(decodeURIComponent(cnj))

  /*
   * Um CNJ malformado é 404, não uma consulta. `numero_cnj` é a chave primária e o
   * CHECK da tabela exige a máscara — mandar lixo ao PostgREST devolveria zero linhas
   * e a tela diria "processo não encontrado" para o que na verdade é um link quebrado.
   */
  if (!CNJ_REGEX.test(numero)) notFound()

  return <ProcessoDetalhe numeroCnj={numero} />
}
