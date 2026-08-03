import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { canAccessRoute } from '@jobsiteos/core'
import { requireSessionContext } from '@/lib/auth'
import { DominiosContato } from '@/components/radar/dominios-contato'

export const metadata: Metadata = { title: 'Domínios — Radar' }

/**
 * Fica no Radar e NÃO é um tipo de lote, ainda que a ideia tenha nascido como "um
 * processo dentro do lote".
 *
 * Um lote é o fluxo de gasto: seleção → estimativa → aprovação → execução com teto de
 * orçamento. Existe porque enriquecer custa dinheiro e alguém precisa autorizar. Isto
 * aqui não chama API nenhuma, não custa nada e não tem o que aprovar — é uma leitura de
 * dado que já está no banco. Passá-la pela cerimônia do lote acrescentaria três telas
 * entre a pessoa e uma correção de um clique, e ainda a deixaria com data de validade
 * (um lote é uma foto; isto tem de estar sempre fresco).
 *
 * Não é admin-only: quem enriquece é quem descobre que o domínio está errado.
 *
 * Saiu das abas do Radar e passou a ser alcançada por um botão no Enriquecimento: é a
 * tela que se abre por causa de um lote (empresa sem domínio é empresa que o Apollo só
 * sabe recusar), não um lugar onde alguém começa o dia. A URL não mudou.
 */
export default async function DominiosPage() {
  const context = await requireSessionContext()
  if (!canAccessRoute('/radar', context.grantedModuleIds)) redirect('/sem-acesso')

  // `contatos` e `empresas` são gated por `app_tem_modulo('empresas')`. Sem esse módulo a
  // consulta volta VAZIA, não com erro — e a tela diria "nenhuma divergência", que é a
  // frase mais enganosa possível: parece uma base limpa e é uma base invisível.
  return (
    <div className="space-y-4">
      <Link href="/radar/lotes" className="text-sm text-muted-foreground hover:underline">
        ← Enriquecimento
      </Link>
      <DominiosContato podeVerEmpresas={canAccessRoute('/empresas', context.grantedModuleIds)} />
    </div>
  )
}
