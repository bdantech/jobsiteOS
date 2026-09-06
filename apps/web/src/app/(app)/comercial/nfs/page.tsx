import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { Card, CardContent } from '@/components/ui/card'
import { FunilKanban } from '@/components/antecipacao/funil-kanban'

export const metadata: Metadata = { title: 'Funil de NFs' }

// O funil muda a cada sincronização de nota; estático serviria contagem velha.
export const dynamic = 'force-dynamic'

/**
 * O funil de NFs do originador: o mesmo Kanban da Antecipação, recortado na carteira
 * dele.
 *
 * Mesma tela e mesmas ações de propósito — o trabalho sobre uma nota é idêntico, o que
 * muda é de quem ela é. Uma segunda tela "igual mas do originador" duplicaria as regras
 * de conversão e perda, que são exatamente as que não podem divergir.
 *
 * A nota vive sob a RLS do módulo `antecipacao`, não do `comercial`. Quem tem só o
 * Comercial veria um Kanban vazio e concluiria que a carteira dele está vazia — o que é
 * uma conclusão errada sobre o próprio trabalho. Por isso a checagem explícita.
 */
export default async function Pagina() {
  const { context, vendedor, ehGestor } = await contextoComercial()

  if (!context.grantedModuleIds.includes('antecipacao')) {
    return (
      <Card>
        <CardContent className="space-y-2 py-10 text-center text-sm text-muted-foreground">
          <p>As notas fiscais vivem no módulo Antecipação, e seu perfil não tem acesso a ele.</p>
          <p>
            Peça a um Admin o módulo <strong>Antecipação</strong> — sem ele esta tela mostraria um
            funil vazio, que não é o mesmo que uma carteira vazia.
          </p>
        </CardContent>
      </Card>
    )
  }

  /*
   * Gestor sem cadastro de vendedor vê o funil inteiro: para ele a pergunta é "onde
   * está a receita", não "onde está a minha".
   *
   * Para o gestor QUE TEM carteira, `vendedorId` é o ponto de partida e não uma trava:
   * a tela abre na carteira dele e o seletor de originador troca de carteira sem sair
   * daqui.
   *
   * Para o ORIGINADOR o recorte é trava: ele abre na própria carteira e fica nela.
   *
   * Para o CLOSER não há recorte inicial nenhum, e é de propósito — nota não é dele,
   * é do time abaixo dele e das contas passivas que ele carrega. Travá-lo no próprio
   * id abriria um funil vazio. Quem recorta aqui é a RLS (0188): ele enxerga a nota de
   * quem `vendedor_acessos` lhe deu, mais a das empresas da carteira dele.
   *
   * `padraoComercial`: aqui o funil é um entre irmãos e a moldura tem de ser a mesma
   * deles. Em /antecipacao ele é a tela inteira e continua como está.
   */
  const recorte = vendedor?.tipo === 'originador' ? vendedor.id : undefined
  return <FunilKanban vendedorId={recorte} ehGestor={ehGestor} padraoComercial />
}
