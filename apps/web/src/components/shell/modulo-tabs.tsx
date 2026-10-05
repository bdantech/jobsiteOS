'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, Pin, PinOff, Settings } from 'lucide-react'
import { getModule } from '@jobsiteos/core'
import { abaEstaAtiva, abasVisiveis, type Aba } from '@/components/shell/abas-dos-modulos'
import { useAtalhos } from '@/components/shell/atalhos-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * A barra de abas de todo módulo. Eram onze cópias da mesma `<nav>`, e elas já tinham
 * divergido: três regras diferentes para decidir qual aba está acesa, duas para o
 * estilo, e só algumas com `aria-current`.
 *
 * Duas coisas que nenhuma das cópias fazia:
 *
 *  - TRABALHO À ESQUERDA, AJUSTE À DIREITA. Abas marcadas `config` no catálogo saem da
 *    fileira e vão para o menu "Configurar". Com uma só, ela vira um link direto com a
 *    engrenagem — um menu de um item é um clique a mais por nada.
 *
 *  - O ALFINETE. Fixa a aba aberta no topo da sidebar. Fica ao lado do menu, e não em
 *    cada aba, porque um ícone por aba dobraria a largura de uma fileira que já rola.
 */

const ESTILO_ABA =
  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function estiloDa(ativo: boolean) {
  return ativo
    ? 'border-primary font-medium text-foreground'
    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
}

interface ModuloTabsProps {
  moduloId: string
  /** "Seções do Crédito" — o nome que o leitor de tela anuncia para a barra. */
  rotulo: string
  /** Só o Comercial passa: decidem as abas por tipo de vendedor e por gestão. */
  ehGestor?: boolean
  tipo?: string | null
  /** Número ao lado da aba que declara `contador` no catálogo. */
  contadores?: Partial<Record<NonNullable<Aba['contador']>, number>>
  className?: string
}

export function ModuloTabs({ moduloId, rotulo, ehGestor, tipo, contadores, className }: ModuloTabsProps) {
  const pathname = usePathname()
  const { visao, estaFixado, alternar } = useAtalhos()
  const raiz = getModule(moduloId)?.route ?? ''

  const abas = abasVisiveis(moduloId, { ...visao, ehGestor, tipo })
  const trabalho = abas.filter((a) => !a.config)
  const ajustes = abas.filter((a) => a.config)
  const ativa = abas.find((a) => abaEstaAtiva(a, pathname, raiz))
  const ajusteAtivo = ativa?.config === true

  return (
    <nav aria-label={rotulo} className={cn('mb-6 flex items-stretch border-b border-border', className)}>
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-px">
        {trabalho.map((aba, i) => {
          const ativo = aba === ativa
          const Icon = aba.icon
          const novoBloco = i > 0 && aba.bloco !== trabalho[i - 1]!.bloco
          const contador = aba.contador ? contadores?.[aba.contador] : undefined
          return (
            <React.Fragment key={aba.href}>
              {novoBloco && (
                <span aria-hidden className="mx-1 my-2.5 w-px shrink-0 self-stretch bg-border" />
              )}
              <Link
                href={aba.href}
                aria-current={ativo ? 'page' : undefined}
                className={cn(ESTILO_ABA, estiloDa(ativo))}
              >
                <Icon className="size-4" aria-hidden />
                {aba.label}
                {contador ? (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium leading-none text-white">
                    {contador > 99 ? '99+' : contador}
                  </span>
                ) : null}
              </Link>
            </React.Fragment>
          )
        })}
      </div>

      <div className="flex shrink-0 items-stretch gap-1 pb-px pl-2">
        {ativa && (
          <button
            type="button"
            onClick={() => alternar(ativa.href)}
            aria-pressed={estaFixado(ativa.href)}
            aria-label={
              estaFixado(ativa.href)
                ? `Desafixar ${ativa.label} da barra lateral`
                : `Fixar ${ativa.label} na barra lateral`
            }
            title={estaFixado(ativa.href) ? 'Desafixar da barra lateral' : 'Fixar na barra lateral'}
            className={cn(
              'my-1 flex w-8 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              estaFixado(ativa.href) ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {estaFixado(ativa.href) ? (
              <PinOff className="size-4" aria-hidden />
            ) : (
              <Pin className="size-4" aria-hidden />
            )}
          </button>
        )}

        {ajustes.length === 1 && (
          <Link
            href={ajustes[0]!.href}
            aria-current={ajusteAtivo ? 'page' : undefined}
            className={cn(ESTILO_ABA, estiloDa(ajusteAtivo))}
          >
            <Settings className="size-4" aria-hidden />
            <span className="hidden sm:inline">{ajustes[0]!.label}</span>
          </Link>
        )}

        {ajustes.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(ESTILO_ABA, estiloDa(ajusteAtivo), 'data-[state=open]:text-foreground')}
            >
              <Settings className="size-4" aria-hidden />
              {/* Com um ajuste aberto, o gatilho diz QUAL — senão a pessoa está numa tela
                  cujo nome não aparece em lugar nenhum da barra. */}
              <span className="hidden sm:inline">{ajusteAtivo ? ativa!.label : 'Configurar'}</span>
              <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {ajustes.map((aba) => {
                const Icon = aba.icon
                const ativo = aba === ativa
                return (
                  <DropdownMenuItem key={aba.href} asChild>
                    <Link
                      href={aba.href}
                      aria-current={ativo ? 'page' : undefined}
                      className={cn('gap-2', ativo && 'font-medium')}
                    >
                      <Icon className="size-4" aria-hidden />
                      {aba.label}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </nav>
  )
}
