import { useSegments } from 'expo-router'
import { useCallback } from 'react'

import { useSession } from '@/lib/auth'
import { canOpenOnMobile } from '@/lib/linking'

/**
 * ABRIR A EMPRESA (OU O FORNECEDOR) SEM SAIR DO FUNIL.
 *
 * `/empresas/<id>` é outra ABA. Empurrá-la de dentro de um funil trocava de aba em
 * vez de empilhar: a empresa abria sobre a lista de Empresas, e o gesto de voltar
 * — ou a seta — levava para essa lista, não para o funil de onde a pessoa veio.
 * No celular, onde voltar é deslizar o dedo, isso é perder o lugar na fila a cada
 * card aberto.
 *
 * Por isso a ficha da empresa também existe DENTRO das pilhas que têm funil
 * (`<modulo>/empresa/[id].tsx`, que só reexporta a tela de Empresas), e estes
 * atalhos escolhem a rota pela pilha em que a pessoa está.
 *
 * ── A CÓPIA NÃO É UMA PORTA LATERAL ─────────────────────────────────────────
 * O portão do app decide pelo primeiro segmento da rota: `/comercial/empresa/x`
 * passaria como Comercial. Então, sem o módulo Empresas, o atalho devolve a rota
 * de sempre — que o portão recusa e explica, como antes — e a própria tela
 * empilhada confere o módulo de novo (ver <TelaDeOutroModulo>), para o caso de
 * alguém chegar nela por um link.
 */

/** As pilhas que têm funil e, por isso, uma cópia da ficha da empresa. */
const PILHAS_COM_EMPRESA = new Set(['antecipacao', 'comercial', 'credito', 'mercado'])

/** A pilha atual: o segmento logo depois de `(tabs)`. */
function pilhaAtual(segmentos: readonly string[]): string | undefined {
  const i = segmentos.indexOf('(tabs)')
  return i >= 0 ? segmentos[i + 1] : undefined
}

/** A rota da ficha da empresa a partir da pilha atual. */
export function useRotaDaEmpresa(): (empresaId: string) => string {
  const segmentos = useSegments()
  const { grantedModuleIds } = useSession()
  const pilha = pilhaAtual(segmentos)
  const podeEmpilhar =
    pilha !== undefined &&
    PILHAS_COM_EMPRESA.has(pilha) &&
    canOpenOnMobile('/empresas', grantedModuleIds)

  return useCallback(
    (empresaId: string): string =>
      podeEmpilhar ? `/${pilha}/empresa/${empresaId}` : `/empresas/${empresaId}`,
    [podeEmpilhar, pilha],
  )
}

/**
 * A rota da ficha do fornecedor. Ela é da Antecipação; o Comercial ganhou uma
 * cópia porque o Funil de NFs abre o mesmo card, e tocar no fornecedor dali
 * trocava de aba pelo mesmo motivo.
 */
export function useRotaDoFornecedor(): (cnpj: string) => string {
  const segmentos = useSegments()
  const { grantedModuleIds } = useSession()
  const noComercial =
    pilhaAtual(segmentos) === 'comercial' && canOpenOnMobile('/antecipacao', grantedModuleIds)

  return useCallback(
    (cnpj: string): string =>
      noComercial ? `/comercial/fornecedor/${cnpj}` : `/antecipacao/fornecedores/${cnpj}`,
    [noComercial],
  )
}
