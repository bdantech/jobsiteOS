'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Os dois desenhos do painel de atividade: a série por dia e o mapa de calor por
 * hora. Sem biblioteca de gráfico, como o resto do repo (ver `GraficoBarras` do
 * Mercado) — o que estes dois precisam é de escala compartilhada e de um tooltip,
 * e nenhuma das duas coisas justifica 40 kB no bundle.
 *
 * ─── POR QUE EMPILHADO, E NÃO UMA LINHA POR PESSOA ──────────────────────────
 * O pedido tem duas perguntas dentro: "quantas empresas o vendedor toca no dia" e
 * "consigo ver todos os vendedores no mesmo gráfico". Linhas sobrepostas
 * respondem bem à primeira e mal à segunda: com quatro pessoas elas viram um
 * emaranhado, e a soma do time — que é o que se olha primeiro — não aparece em
 * lugar nenhum. Empilhado, a altura da coluna é o dia do TIME e cada faixa é uma
 * pessoa, com a cor estável entre os dois gráficos.
 */

export interface PontoDia {
  dia: string
  vendedor_id: string
  vendedor_nome: string
  is_ia: boolean
  empresas: number
  mensagens: number
}

export interface PontoHora {
  vendedor_id: string
  vendedor_nome: string
  is_ia: boolean
  hora: number
  total: number
}

/**
 * A cor é derivada do NOME, com a mesma função do inbox: a mesma pessoa tem a
 * mesma cor nos dois gráficos, na legenda e na lista de conversas. Cor por
 * posição na lista mudaria a cada filtro, e a legenda deixaria de ser memorizável.
 */
const PALETA = [
  { barra: 'bg-sky-500', ponto: 'bg-sky-500' },
  { barra: 'bg-emerald-500', ponto: 'bg-emerald-500' },
  { barra: 'bg-amber-500', ponto: 'bg-amber-500' },
  { barra: 'bg-violet-500', ponto: 'bg-violet-500' },
  { barra: 'bg-rose-500', ponto: 'bg-rose-500' },
  { barra: 'bg-teal-500', ponto: 'bg-teal-500' },
] as const

export function corDoVendedor(nome: string): (typeof PALETA)[number] {
  let soma = 0
  for (let i = 0; i < nome.length; i++) soma = (soma + nome.charCodeAt(i)) % 997
  return PALETA[soma % PALETA.length]!
}

const diaCurto = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// ─── Empresas tocadas por dia ───────────────────────────────────────────────

export function GraficoEmpresasPorDia({
  pontos,
  metrica,
}: {
  pontos: PontoDia[]
  /** O que a altura mede. Empresas por padrão; mensagens quando se quer volume. */
  metrica: 'empresas' | 'mensagens'
}) {
  const [foco, setFoco] = React.useState<{ dia: string; texto: string[] } | null>(null)

  const { dias, vendedores, maximo } = React.useMemo(() => {
    const porDia = new Map<string, PontoDia[]>()
    const nomes = new Map<string, string>()
    for (const p of pontos) {
      porDia.set(p.dia, [...(porDia.get(p.dia) ?? []), p])
      nomes.set(p.vendedor_id, p.vendedor_nome)
    }
    const lista = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b))
    const max = lista.reduce(
      (maior, [, ps]) => Math.max(maior, ps.reduce((s, p) => s + p[metrica], 0)),
      0,
    )
    return {
      dias: lista,
      vendedores: [...nomes.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')),
      maximo: max,
    }
  }, [pontos, metrica])

  if (dias.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nenhuma atividade no período.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs">
        {vendedores.map(([id, nome]) => (
          <span key={id} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-sm', corDoVendedor(nome).ponto)} aria-hidden />
            {nome}
          </span>
        ))}
      </div>

      {/*
        Rola no eixo x: 90 dias não cabem numa tela, e comprimir a coluna até
        caber transforma o gráfico numa mancha. O contêiner rola; a página não.
      */}
      <div className="relative overflow-x-auto pb-1">
        <div className="flex h-52 items-end gap-1" style={{ minWidth: `${dias.length * 28}px` }}>
          {dias.map(([dia, ps]) => {
            const total = ps.reduce((s, p) => s + p[metrica], 0)
            return (
              <div
                key={dia}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                onMouseEnter={() =>
                  setFoco({
                    dia,
                    texto: [...ps]
                      .sort((a, b) => b[metrica] - a[metrica])
                      .map((p) => `${p.vendedor_nome}: ${p[metrica]}`),
                  })
                }
                onMouseLeave={() => setFoco(null)}
              >
                <span className="text-[10px] tabular-nums text-muted-foreground">{total || ''}</span>
                <div className="flex w-full flex-1 flex-col-reverse justify-start">
                  {[...ps]
                    .sort((a, b) => a.vendedor_nome.localeCompare(b.vendedor_nome, 'pt-BR'))
                    .map((p) => (
                      <div
                        key={p.vendedor_id}
                        className={cn('w-full', corDoVendedor(p.vendedor_nome).barra)}
                        style={{
                          // `maximo` é do dia mais cheio: as colunas são
                          // comparáveis entre si, e não cada uma consigo mesma.
                          height: `${maximo > 0 ? (p[metrica] / maximo) * 100 : 0}%`,
                        }}
                        title={`${p.vendedor_nome} — ${p[metrica]} em ${diaCurto(dia)}`}
                      />
                    ))}
                </div>
                <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                  {diaCurto(dia)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {foco ? (
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">{diaCurto(foco.dia)}</strong> — {foco.texto.join(' · ')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Passe o mouse numa coluna para ver a divisão do dia.
        </p>
      )}
    </div>
  )
}

// ─── Mapa de calor por hora ─────────────────────────────────────────────────

const HORAS = Array.from({ length: 24 }, (_, i) => i)

/**
 * Uma linha por pessoa, 24 colunas, intensidade = volume.
 *
 * A escala é do MAIOR VALOR DA GRADE inteira, e não de cada linha: com escala por
 * linha, quem mandou 3 mensagens no dia inteiro fica tão "quente" quanto quem
 * mandou 300, e o mapa passa a comparar cada um consigo mesmo — que é justamente
 * o que um mapa de equipe não deve fazer.
 */
export function MapaDeCalorPorHora({ pontos }: { pontos: PontoHora[] }) {
  const { linhas, maximo } = React.useMemo(() => {
    const porVendedor = new Map<string, { nome: string; horas: Map<number, number> }>()
    let max = 0
    for (const p of pontos) {
      const atual = porVendedor.get(p.vendedor_id) ?? { nome: p.vendedor_nome, horas: new Map() }
      atual.horas.set(p.hora, (atual.horas.get(p.hora) ?? 0) + p.total)
      porVendedor.set(p.vendedor_id, atual)
      max = Math.max(max, atual.horas.get(p.hora)!)
    }
    return {
      linhas: [...porVendedor.entries()].sort((a, b) =>
        a[1].nome.localeCompare(b[1].nome, 'pt-BR'),
      ),
      maximo: max,
    }
  }, [pontos])

  if (linhas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nenhuma atividade no período.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="min-w-[42rem] space-y-1">
          <div className="flex items-center gap-1 pl-32">
            {HORAS.map((h) => (
              <span
                key={h}
                className="flex-1 text-center text-[9px] tabular-nums text-muted-foreground"
              >
                {/* De duas em duas: 24 rótulos de dois dígitos não cabem sem virar ruído. */}
                {h % 2 === 0 ? String(h).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
          {linhas.map(([id, l]) => (
            <div key={id} className="flex items-center gap-1">
              <span className="w-32 shrink-0 truncate text-xs" title={l.nome}>
                {l.nome}
              </span>
              {HORAS.map((h) => {
                const n = l.horas.get(h) ?? 0
                const intensidade = maximo > 0 ? n / maximo : 0
                return (
                  <span
                    key={h}
                    title={`${l.nome} — ${String(h).padStart(2, '0')}h: ${n} ${n === 1 ? 'mensagem' : 'mensagens'}`}
                    className={cn(
                      'h-6 flex-1 rounded-sm',
                      n === 0 ? 'bg-muted' : corDoVendedor(l.nome).barra,
                    )}
                    style={
                      n === 0
                        ? undefined
                        : // Opacidade e não seis tons de classe: a rampa precisa ser
                          // contínua para que 5 e 6 mensagens não caiam no mesmo balde,
                          // e o piso de 0,15 mantém a célula de 1 mensagem visível.
                          { opacity: 0.15 + intensidade * 0.85 }
                    }
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Horário de São Paulo. A intensidade é comparável entre as linhas — a célula mais forte é o
        pico da equipe no período, não o de cada pessoa.
      </p>
    </div>
  )
}

export function CartaoGrafico({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
