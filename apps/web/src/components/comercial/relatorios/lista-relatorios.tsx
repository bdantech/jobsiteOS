import Link from 'next/link'
import { ArrowRight, FileText, Inbox, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Os relatórios do Comercial, um card por relatório.
 *
 * Relatório novo entra AQUI e ganha uma rota própria embaixo de /comercial/relatorios —
 * a aba do módulo continua sendo uma só.
 */
const RELATORIOS: { href: string; titulo: string; descricao: string; cadencia: string; icon: LucideIcon }[] = [
  {
    href: '/comercial/relatorios/semanal',
    titulo: 'Report semanal executivo',
    descricao:
      'A semana fechada da casa: funil comercial, volume operado, receita, carteira e o desempenho de cada pessoa do time. É o mesmo conteúdo do PDF enviado por e-mail.',
    cadencia: 'Semana fechada · histórico de envios',
    icon: FileText,
  },
  {
    href: '/comercial/relatorios/documentos-sem-dono',
    titulo: 'Documentos sem dono e carteiras',
    descricao:
      'Notas, títulos e pré-autorizações sem originador: quanto é, quem concentra, por que está sem dono e quais contas dá para atribuir. E onde estão os documentos de cada originador.',
    cadencia: 'Ao vivo · retrato do momento',
    icon: Inbox,
  },
]

export function ListaRelatorios() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Relatórios</h1>
        <p className="text-xs text-muted-foreground">Escolha um relatório para abrir.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {RELATORIOS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <r.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <ArrowRight
                    className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </div>
                <CardTitle className="text-sm">{r.titulo}</CardTitle>
                <CardDescription className="text-[11px]">{r.cadencia}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs leading-relaxed text-muted-foreground">{r.descricao}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
