'use client'

import { ArrowDown, ArrowUp, ChevronRight, Pin, PinOff } from 'lucide-react'
import { grantedModuleGroups } from '@jobsiteos/core'
import {
  abasVisiveis,
  resolverAtalho,
  type Atalho,
  type VisaoDoUsuario,
} from '@/components/shell/abas-dos-modulos'
import { useAtalhos } from '@/components/shell/atalhos-provider'
import { moduleIcon } from '@/components/shell/icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * "Barra lateral": o que a pessoa fixou no topo da sidebar e tudo o que ela pode fixar.
 *
 * A lista vem do mesmo catálogo que desenha as barras de abas, filtrada com a mesma
 * visão (admin, gestão, tipo de vendedor) que o servidor resolveu para esta pessoa —
 * então aqui só aparece aba que ela de fato vê no módulo. As mudanças valem na hora:
 * a sidebar ao lado lê o mesmo estado (AtalhosProvider).
 */
export function AtalhosCard({ visao }: { visao: VisaoDoUsuario }) {
  const { fixados, estaFixado, alternar, remover, mover } = useAtalhos()

  const atalhos = fixados
    .map((href) => resolverAtalho(href, visao))
    .filter((a): a is Atalho => a !== null)

  const modulos = grantedModuleGroups(visao.modulos).flatMap((g) => g.modules)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Barra lateral</CardTitle>
        <CardDescription>
          Fixe módulos e abas no topo da barra lateral. Também dá para fixar pelo alfinete que
          aparece ao passar o mouse sobre um módulo, ou pelo que fica ao lado das abas de cada
          módulo.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Fixados</h3>
          {atalhos.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Nada fixado ainda. Escolha abaixo o que você abre todo dia.
            </p>
          ) : (
            <ol className="divide-y rounded-md border">
              {atalhos.map((atalho, i) => {
                const Icon = atalho.icon
                return (
                  <li key={atalho.href} className="flex items-center gap-3 px-3 py-1.5">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {atalho.label}
                      {!atalho.ehModulo && (
                        <span className="text-muted-foreground"> · {atalho.moduloNome}</span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={i === 0}
                      onClick={() => mover(atalho.href, -1)}
                      aria-label={`Subir ${atalho.label}`}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={i === atalhos.length - 1}
                      onClick={() => mover(atalho.href, 1)}
                      aria-label={`Descer ${atalho.label}`}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => remover(atalho.href)}
                      aria-label={`Desafixar ${atalho.label}`}
                    >
                      <PinOff aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Disponíveis</h3>
          <div className="divide-y rounded-md border">
            {modulos.map((modulo) => {
              const Icon = moduleIcon(modulo.icon)
              // A aba que É a raiz do módulo (o Funil da Antecipação, o Mapa do Mercado)
              // não aparece de novo: fixá-la é fixar o módulo, e duas linhas para o mesmo
              // caminho acenderiam juntas.
              const abas = abasVisiveis(modulo.id, visao).filter((a) => a.href !== modulo.route)
              const quantos = [modulo.route, ...abas.map((a) => a.href)].filter(estaFixado).length

              return (
                <details key={modulo.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                      aria-hidden
                    />
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1 font-medium">{modulo.name}</span>
                    {quantos > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {quantos} {quantos === 1 ? 'fixado' : 'fixados'}
                      </span>
                    )}
                  </summary>

                  <ul className="pb-2">
                    <LinhaFixavel
                      label={`${modulo.name} (o módulo inteiro)`}
                      fixado={estaFixado(modulo.route)}
                      onAlternar={() => alternar(modulo.route)}
                    />
                    {abas.map((aba) => (
                      <LinhaFixavel
                        key={aba.href}
                        label={aba.label}
                        icon={aba.icon}
                        detalhe={aba.config ? 'configuração' : undefined}
                        fixado={estaFixado(aba.href)}
                        onAlternar={() => alternar(aba.href)}
                      />
                    ))}
                  </ul>
                </details>
              )
            })}
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

function LinhaFixavel({
  label,
  icon: Icon,
  detalhe,
  fixado,
  onAlternar,
}: {
  label: string
  icon?: Atalho['icon']
  detalhe?: string
  fixado: boolean
  onAlternar: () => void
}) {
  return (
    <li className="flex items-center gap-3 py-1 pl-10 pr-3">
      {Icon ? (
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">
        {label}
        {detalhe && <span className="text-xs text-muted-foreground"> · {detalhe}</span>}
      </span>
      <Button
        variant={fixado ? 'secondary' : 'ghost'}
        size="sm"
        className={cn('h-8 gap-1.5', fixado && 'text-primary')}
        onClick={onAlternar}
        aria-pressed={fixado}
      >
        {fixado ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        {fixado ? 'Desafixar' : 'Fixar'}
      </Button>
    </li>
  )
}
