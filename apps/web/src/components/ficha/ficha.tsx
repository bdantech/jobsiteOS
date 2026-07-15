import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * As peças de uma FICHA — a tela de detalhe de uma entidade. Hoje: a empresa (Company
 * 360) e o CNPJ do universo. Eram a mesma tela desenhada duas vezes, com o mesmo
 * cabeçalho reescrito em cada uma e já derivando (uma com `-ml-2` no voltar, a outra com
 * `-ml-3`; uma com o CNPJ em `text-sm`, a outra em `font-mono`).
 *
 * ── A forma ────────────────────────────────────────────────────────────────────
 *   voltar
 *   título .......................................... [ação]
 *   [ abas ]
 *   ┌── identidade (1/3) ──┐  ┌── conteúdo da aba (2/3) ──────────┐
 *   │ avatar               │  │ card                              │
 *   │ nome, tags           │  │ card                              │
 *   │ ┌ resumo ┬ resumo ┐  │  │                                   │
 *   │ dados                │  │                                   │
 *   └──────────────────────┘  └───────────────────────────────────┘
 *
 * A identidade FICA. Ela não é uma aba: é quem a pessoa está olhando, e sumir com ela ao
 * trocar de aba é a maneira mais rápida de alguém editar a empresa errada. As abas
 * trocam só a coluna da direita.
 *
 * ── Por que caixas dentro de caixas ────────────────────────────────────────────
 * A tira de resumo tem fundo e borda próprios, embutida no card de identidade. Um grupo
 * pequeno e cercado dentro de um grupo grande lê como um bloco só; as mesmas quatro
 * linhas soltas leem como quatro coisas.
 */

export function FichaVoltar({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
      <Link href={href}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {children}
      </Link>
    </Button>
  )
}

/** O topo da página: o que é esta tela, e o único botão que MOVE a entidade. */
export function FichaTopo({
  titulo,
  descricao,
  acao,
}: {
  titulo: string
  descricao?: string
  acao?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao ? <p className="text-sm text-muted-foreground">{descricao}</p> : null}
      </div>
      {acao ? <div className="flex shrink-0 flex-col items-end gap-1">{acao}</div> : null}
    </div>
  )
}

/**
 * O avatar de uma empresa: as iniciais dela.
 *
 * Não há logo de empresa em lugar nenhum deste banco — o dump da Receita traz razão
 * social, não marca. Um placeholder genérico (o mesmo prédio cinza em toda ficha) não
 * distingue nada; as iniciais, sim, e é o que dá à coluna da esquerda uma âncora visual
 * em vez de começar com texto.
 */
export function FichaAvatar({ nome }: { nome: string }) {
  const iniciais =
    nome
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((p) => p.length > 1)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '—'

  return (
    <div
      aria-hidden
      className="flex size-20 shrink-0 items-center justify-center rounded-full border bg-muted text-xl font-semibold tracking-wide text-muted-foreground"
    >
      {iniciais}
    </div>
  )
}

/** Um par rótulo/valor. Era declarado uma vez por tela. */
export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="truncate text-sm">{children}</div>
    </div>
  )
}

export interface ItemResumo {
  label: string
  valor: ReactNode
}

/**
 * A tira de números da entidade: a caixa embutida no card de identidade.
 *
 * `divide-x` só desenha as linhas ENTRE as células, e some quando quebra para uma coluna
 * no celular — que é o certo: uma borda vertical num empilhamento vertical não separa
 * nada, só rabisca.
 */
export function FichaResumo({ itens }: { itens: ItemResumo[] }) {
  if (itens.length === 0) return null

  return (
    <dl className="grid grid-cols-3 divide-x rounded-lg border bg-muted/40">
      {itens.map((item) => (
        <div key={item.label} className="min-w-0 px-2 py-3 text-center">
          <dd className="truncate text-base font-semibold tabular-nums">{item.valor}</dd>
          <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
        </div>
      ))}
    </dl>
  )
}

export interface LinhaFicha {
  icone: ComponentType<{ className?: string }>
  /** Lido por leitor de tela no lugar do ícone, que é decorativo. */
  label: string
  valor: ReactNode
}

/** As linhas com ícone do card de identidade — o "contato" da referência. */
export function FichaLinhas({ linhas }: { linhas: LinhaFicha[] }) {
  return (
    <dl className="space-y-3">
      {linhas.map(({ icone: Icone, label, valor }) => (
        <div key={label} className="flex items-start gap-3 text-sm">
          <Icone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <dt className="sr-only">{label}</dt>
          <dd className="min-w-0 break-words">{valor}</dd>
        </div>
      ))}
    </dl>
  )
}

interface FichaIdentidadeProps {
  nome: string
  /** Nome fantasia, ou o que a entidade É — a linha sob o nome. */
  papel?: string | null
  /** Estágio, camada, situação, tipo… as tags que qualificam. */
  tags?: ReactNode
  /** A tira de números. Omitida quando a entidade não tem números próprios. */
  resumo?: ItemResumo[]
  linhas?: LinhaFicha[]
  /** Pé do card: datas, procedência. */
  rodape?: ReactNode
}

/** O card principal, à esquerda: quem é esta entidade. Persiste entre as abas. */
export function FichaIdentidade({
  nome,
  papel,
  tags,
  resumo,
  linhas,
  rodape,
}: FichaIdentidadeProps) {
  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <FichaAvatar nome={nome} />

          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold leading-tight">{nome}</h2>
            {papel ? <p className="text-sm text-muted-foreground">{papel}</p> : null}
          </div>

          {tags ? <div className="flex flex-wrap justify-center gap-1.5">{tags}</div> : null}
        </div>

        {resumo && resumo.length > 0 ? <FichaResumo itens={resumo} /> : null}

        {linhas && linhas.length > 0 ? (
          <div className="border-t pt-5">
            <FichaLinhas linhas={linhas} />
          </div>
        ) : null}

        {rodape ? <p className="border-t pt-4 text-xs text-muted-foreground">{rodape}</p> : null}
      </CardContent>
    </Card>
  )
}

/**
 * A grade: identidade estreita à esquerda, conteúdo largo à direita.
 *
 * `items-start` para o card de identidade não esticar até a altura da coluna da direita —
 * uma aba com uma tabela de 40 linhas deixaria um card de identidade de 40 linhas de
 * altura, quase todo vazio.
 */
export function FichaGrade({
  identidade,
  conteudo,
  className,
}: {
  identidade: ReactNode
  conteudo: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid items-start gap-6 lg:grid-cols-3', className)}>
      <div className="lg:col-span-1">{identidade}</div>
      <div className="space-y-6 lg:col-span-2">{conteudo}</div>
    </div>
  )
}
