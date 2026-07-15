'use client'

import * as React from 'react'
import type { Camada } from '@jobsiteos/core'
import { CAMADA_LABELS } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * As camadas do mercado como círculos concêntricos: SOM ⊂ SAM ⊂ TAM ⊂ Universo.
 *
 * ── ISTO É UM DIAGRAMA, NÃO UM GRÁFICO DE ÁREA ─────────────────────────────────
 * Os raios são FIXOS. Não codificam a contagem, e não podem: com dados reais o universo
 * tem ~2 milhões de CNPJs e o SOM alguns milhares. Área proporcional (raio ∝ √contagem)
 * daria ao SOM cerca de 5% do diâmetro do universo — um ponto invisível, exatamente a
 * camada que mais importa. Então a figura carrega a ESTRUTURA (contenção) e os NÚMEROS
 * carregam a magnitude. Por isso a contagem é sempre impressa, nunca só insinuada pelo
 * tamanho.
 *
 * ── Por que tangentes embaixo, e não concêntricos ──────────────────────────────
 * Círculos com o mesmo centro deixam anéis finos e iguais dos dois lados. Alinhando-os
 * pela base, toda a folga se acumula EM CIMA — e é lá que cabe o rótulo de cada camada,
 * dentro da própria faixa a que ele pertence.
 *
 * ── Sem borda entre as faixas ──────────────────────────────────────────────────
 * As faixas se tocam. A separação é feita pelo DEGRAU DE COR da rampa ordinal
 * (--chart-1..4), que já é a fronteira; a linha da cor da superfície por cima dela era
 * um segundo contorno dizendo a mesma coisa, e desenhava um halo em volta de cada
 * círculo.
 *
 * ── A informação abre no CLIQUE ────────────────────────────────────────────────
 * Não no hover. Hover não existe no toque, e um painel que aparece e some enquanto o
 * cursor atravessa o diagrama pisca a cada movimento. Clicar seleciona; a seleção
 * destaca a faixa, esmaece as outras e abre o painel — um estado, deliberado, que
 * sobrevive ao dedo e ao teclado.
 */

export interface DadosCamada {
  camada: Camada
  total: number
  participacao: number
  /** Os indicadores da camada, distribuídos na horizontal dentro do painel. */
  metricas: { label: string; valor: string }[]
  descricao: string
}

interface CirculosCamadasProps {
  dados: DadosCamada[]
  /** Camada em destaque. As demais ficam esmaecidas. */
  selecionada: Camada | null
  onSelecionar: (camada: Camada) => void
  /**
   * Ação oferecida DENTRO do painel da camada selecionada.
   *
   * Existe porque o clique na faixa passou a selecionar, e no Mapa ele antes navegava
   * para o Explorador. O drill-down não some — ele deixa de ser um efeito colateral do
   * clique e vira um botão que se anuncia.
   */
  acao?: { label: string; onClick: (camada: Camada) => void }
  /**
   * O que o clique entrega, nas palavras da tela que hospeda o diagrama: no Mapa são os
   * indicadores da camada, na aba Camadas é a regra dela. Prometer "indicadores" onde
   * abre um editor de regra seria mentir sobre o próprio botão.
   */
  dicaVazia?: string
  /**
   * Desliga o painel da camada selecionada, deixando o diagrama ser só o seletor.
   *
   * É o caso da aba Camadas: lá quem responde ao clique é o card "Regra da camada", logo
   * abaixo, e o cabeçalho DELE já imprime nome, contagem, participação e descrição. O
   * painel repetiria as mesmas quatro coisas 200px acima.
   */
  painel?: boolean
  className?: string
}

/** Ordem de DESENHO: o maior primeiro, para os menores ficarem por cima. */
const ORDEM: Camada[] = ['universo', 'tam', 'sam', 'som']

const GEOMETRIA: Record<Camada, { r: number; cy: number; rotuloY: number }> = {
  // cy = ALTURA - r  ⇒ todas tangentes na base (y = 200).
  universo: { r: 100, cy: 100, rotuloY: 20 },
  tam: { r: 80, cy: 120, rotuloY: 60 },
  sam: { r: 60, cy: 140, rotuloY: 100 },
  som: { r: 40, cy: 160, rotuloY: 140 },
}

const PREENCHIMENTO: Record<Camada, string> = {
  universo: 'fill-chart-1',
  tam: 'fill-chart-2',
  sam: 'fill-chart-3',
  som: 'fill-chart-4',
}

/**
 * A tinta do rótulo segue o DEGRAU, não o tema: chart-1/2 são claros e pedem texto
 * escuro; chart-3/4 são escuros e pedem texto claro. Como os dois tokens já invertem
 * com o tema, uma classe só está correta no claro e no escuro.
 */
const TINTA_ROTULO: Record<Camada, string> = {
  universo: 'fill-foreground',
  tam: 'fill-foreground',
  sam: 'fill-background',
  som: 'fill-background',
}

export function CirculosCamadas({
  dados,
  selecionada,
  onSelecionar,
  acao,
  dicaVazia = 'Clique em uma camada para ver os indicadores dela.',
  painel = true,
  className,
}: CirculosCamadasProps) {
  /**
   * O anel de foco só aparece para quem chegou pelo teclado. Um anel tracejado atrás de
   * todo clique de mouse é ruído; sem anel nenhum, navegar por Tab no diagrama é navegar
   * às cegas. `:focus-visible` é exatamente essa distinção, e o navegador já a computa.
   */
  const [focoTeclado, setFocoTeclado] = React.useState<Camada | null>(null)

  const porCamada = React.useMemo(() => new Map(dados.map((d) => [d.camada, d])), [dados])
  const dadosSelecionados = selecionada ? porCamada.get(selecionada) : null

  return (
    <div className={cn('flex flex-col items-center gap-5', className)}>
      <svg
        viewBox="0 0 200 200"
        className="h-auto w-full max-w-[260px] shrink-0"
        role="group"
        aria-label="Camadas do mercado: universo, TAM, SAM e SOM"
      >
        {ORDEM.map((camada) => {
          const d = porCamada.get(camada)
          if (!d) return null

          const { r, cy, rotuloY } = GEOMETRIA[camada]
          const ativa = selecionada === camada
          const recuada = selecionada !== null && !ativa

          return (
            <g
              key={camada}
              onClick={() => onSelecionar(camada)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelecionar(camada)
                }
              }}
              onFocus={(e) => {
                if (e.currentTarget.matches(':focus-visible')) setFocoTeclado(camada)
              }}
              onBlur={() => setFocoTeclado(null)}
              tabIndex={0}
              role="button"
              aria-label={`${CAMADA_LABELS[camada]}: ${d.total.toLocaleString('pt-BR')} empresas, ${d.participacao}% do universo`}
              aria-pressed={ativa}
              className={cn(
                'cursor-pointer transition-opacity duration-200 focus:outline-none',
                recuada ? 'opacity-30' : 'opacity-100',
              )}
            >
              <circle cx="100" cy={cy} r={r} className={PREENCHIMENTO[camada]} />

              {/* Anel de foco de teclado: um segundo círculo, porque um outline de CSS
                  num <g> de SVG desenha um retângulo, não o círculo. */}
              {focoTeclado === camada ? (
                <circle
                  cx="100"
                  cy={cy}
                  r={r - 1}
                  fill="none"
                  className="stroke-ring stroke-[1.5]"
                  strokeDasharray="4 3"
                />
              ) : null}

              <text
                x="100"
                y={rotuloY}
                textAnchor="middle"
                className={cn(
                  'select-none text-[8px] font-semibold uppercase tracking-[0.1em]',
                  TINTA_ROTULO[camada],
                )}
              >
                {CAMADA_LABELS[camada]}
              </text>
              <text
                x="100"
                y={rotuloY + 11}
                textAnchor="middle"
                className={cn('select-none text-[7px] tabular-nums', TINTA_ROTULO[camada])}
              >
                {d.total.toLocaleString('pt-BR')}
              </text>
            </g>
          )
        })}
      </svg>

      {dadosSelecionados ? (
        painel ? <PainelCamada dados={dadosSelecionados} acao={acao} /> : null
      ) : (
        <p className="text-center text-sm text-muted-foreground">{dicaVazia}</p>
      )}
    </div>
  )
}

/**
 * O painel fica ABAIXO do diagrama e ocupa a largura toda — não é um balão flutuante
 * nem uma coluna estreita ao lado.
 *
 * Consequência de layout, não estética: com a largura inteira disponível, os nove
 * indicadores se espalham numa grade horizontal de até cinco colunas e o painel tem
 * DUAS linhas de altura. Empilhados numa coluna de 24rem eram nove linhas — uma torre
 * mais alta que o próprio diagrama que ela estava explicando.
 */
function PainelCamada({
  dados,
  acao,
}: {
  dados: DadosCamada
  acao?: { label: string; onClick: (camada: Camada) => void }
}) {
  return (
    <div className="w-full rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{CAMADA_LABELS[dados.camada]}</h3>

        <p className="text-xl font-semibold tabular-nums">
          {dados.total.toLocaleString('pt-BR')}
          <span className="ml-1 text-xs font-normal text-muted-foreground">empresas</span>
        </p>

        <span className="text-xs tabular-nums text-muted-foreground">
          {/* pt-BR usa vírgula decimal. `{participacao}%` cru imprimiria "12.4%", que num
              app inteiro em português é um erro de digitação com cara de bug. */}
          {dados.participacao.toLocaleString('pt-BR', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
          % do universo
        </span>

        {acao ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => acao.onClick(dados.camada)}
          >
            {acao.label}
          </Button>
        ) : null}
      </div>

      {dados.metricas.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
          {dados.metricas.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="truncate text-muted-foreground">{m.label}</dt>
              <dd className="truncate font-medium tabular-nums">{m.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{dados.descricao}</p>
    </div>
  )
}
