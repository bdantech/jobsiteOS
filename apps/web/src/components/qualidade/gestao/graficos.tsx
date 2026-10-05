'use client'

import * as React from 'react'
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Amostra, Dica, usePaleta } from './comum'
import { inteiro, pct, semanaCurta } from './formato'

/**
 * Os gráficos da Visão geral da Qualidade.
 *
 * ─── HUMANO E IA NA MESMA RÉGUA ─────────────────────────────────────────────
 * O §7 diz que o agente de IA tem a mesma aba de feedback "para comparar IA e humano na
 * mesma régua" — então os dois aparecem lado a lado, no MESMO eixo, sempre com as mesmas
 * cores (humano = slot 0, IA = slot 1 da paleta categórica validada). Dois eixos, um por
 * grupo, fariam qualquer diferença parecer o que a escala quisesse.
 *
 * ─── A COR NUNCA É O ÚNICO CANAL ────────────────────────────────────────────
 * Toda barra tem rótulo direto com o valor; a legenda nomeia as séries em texto; o
 * tooltip traz o número de análises que sustenta cada ponto — uma taxa de 100% sobre
 * duas análises não é a mesma coisa que sobre duzentas, e o gráfico não pode esconder isso.
 */

const ROTULO_GRUPO = { humano: 'Humanos', ia: 'Agentes de IA' } as const

// ─── Por etapa da rubrica ───────────────────────────────────────────────────

export interface PontoEtapa {
  etapa: string
  humano: number | null
  ia: number | null
  itens_humano: number
  itens_ia: number
}

/**
 * Taxa de itens atendidos por etapa (ponderada pelo peso). Barras AGRUPADAS e não
 * empilhadas: o que se compara é humano contra IA dentro da etapa, e empilhar somaria
 * duas taxas — um número que não quer dizer nada.
 */
export function BarrasEtapa({ pontos }: { pontos: PontoEtapa[] }) {
  const paleta = usePaleta()
  const temIa = pontos.some((p) => p.ia !== null)
  if (pontos.length === 0) return null

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={pontos} margin={{ top: 18, right: 8, bottom: 4, left: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="etapa" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tick={{ fontSize: 10 }}
            width={40}
            stroke="currentColor"
            className="text-muted-foreground"
            tickFormatter={(v: number) => pct(v)}
          />
          <Tooltip
            cursor={{ className: 'fill-muted/40' }}
            content={({ payload, label }) => {
              const d = payload?.[0]?.payload as PontoEtapa | undefined
              return d ? (
                <Dica>
                  <p className="font-medium">{String(label)}</p>
                  <p className="tabular-nums text-muted-foreground">
                    {ROTULO_GRUPO.humano}: {pct(d.humano)} · {inteiro(d.itens_humano)} itens
                  </p>
                  {temIa ? (
                    <p className="tabular-nums text-muted-foreground">
                      {ROTULO_GRUPO.ia}: {pct(d.ia)} · {inteiro(d.itens_ia)} itens
                    </p>
                  ) : null}
                </Dica>
              ) : null
            }}
          />
          {temIa ? <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => ROTULO_GRUPO[v as 'humano' | 'ia'] ?? v} /> : null}
          <Bar dataKey="humano" fill={paleta[0]} radius={[4, 4, 0, 0]} maxBarSize={36}>
            <LabelList
              dataKey="humano"
              position="top"
              className="fill-foreground text-[10px] tabular-nums"
              formatter={(v: unknown) => (v === null || v === undefined ? '' : pct(Number(v)))}
            />
          </Bar>
          {temIa ? (
            <Bar dataKey="ia" fill={paleta[1]} radius={[4, 4, 0, 0]} maxBarSize={36}>
              <LabelList
                dataKey="ia"
                position="top"
                className="fill-foreground text-[10px] tabular-nums"
                formatter={(v: unknown) => (v === null || v === undefined ? '' : pct(Number(v)))}
              />
            </Bar>
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Objeções ───────────────────────────────────────────────────────────────

/**
 * Distribuição das objeções registradas. Barras HORIZONTAIS: os nomes ("não é o momento",
 * "burocracia") são longos e lidos, não adivinhados num eixo inclinado. Uma série só, uma
 * cor só — a categoria está no eixo, e pintar cada objeção de uma cor sugeriria uma
 * identidade que não existe.
 */
export function BarrasObjecoes({ objecoes }: { objecoes: Array<{ objecao: string; n: number }> }) {
  const paleta = usePaleta()
  const dados = objecoes.map((o) => ({ objecao: o.objecao, n: Number(o.n) }))
  if (dados.length === 0) return null

  return (
    <div style={{ height: Math.max(dados.length * 32 + 16, 80) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="objecao"
            width={120}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            className="text-muted-foreground"
          />
          <Tooltip
            cursor={{ className: 'fill-muted/40' }}
            content={({ payload }) => {
              const d = payload?.[0]?.payload as { objecao: string; n: number } | undefined
              return d ? (
                <Dica>
                  <p className="font-medium">{d.objecao}</p>
                  <p className="tabular-nums text-muted-foreground">{inteiro(d.n)} interação(ões)</p>
                </Dica>
              ) : null
            }}
          />
          <Bar dataKey="n" fill={paleta[0]} radius={[0, 4, 4, 0]} maxBarSize={22}>
            <LabelList dataKey="n" position="right" className="fill-foreground text-[11px] tabular-nums" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Evolução semanal ───────────────────────────────────────────────────────

export interface PontoEvolucao {
  semana: string
  humano: number | null
  ia: number | null
  analises_humano: number
  analises_ia: number
}

/**
 * A nota média publicada por semana. Linha, porque a pergunta é a FORMA ao longo do
 * tempo; os pontos marcam semanas com dado (semana sem análise fica sem ponto, e a linha
 * conecta por cima — `connectNulls` — para não desenhar um zero que não houve).
 */
export function LinhaEvolucao({ pontos }: { pontos: PontoEvolucao[] }) {
  const paleta = usePaleta()
  const temIa = pontos.some((p) => p.ia !== null)
  if (pontos.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pontos} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis
              dataKey="semana"
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              className="text-muted-foreground"
              tickFormatter={(v: string) => semanaCurta(v)}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tick={{ fontSize: 10 }}
              width={40}
              stroke="currentColor"
              className="text-muted-foreground"
              tickFormatter={(v: number) => v.toFixed(2).replace('.', ',')}
            />
            <Tooltip
              content={({ payload, label }) => {
                const d = payload?.[0]?.payload as PontoEvolucao | undefined
                return d ? (
                  <Dica>
                    <p className="font-medium">Semana de {semanaCurta(String(label))}</p>
                    <p className="tabular-nums text-muted-foreground">
                      {ROTULO_GRUPO.humano}: {d.humano === null ? '—' : d.humano.toFixed(2).replace('.', ',')} ·{' '}
                      {inteiro(d.analises_humano)} análise(s)
                    </p>
                    {temIa ? (
                      <p className="tabular-nums text-muted-foreground">
                        {ROTULO_GRUPO.ia}: {d.ia === null ? '—' : d.ia.toFixed(2).replace('.', ',')} ·{' '}
                        {inteiro(d.analises_ia)} análise(s)
                      </p>
                    ) : null}
                  </Dica>
                ) : null
              }}
            />
            <Line
              type="monotone"
              dataKey="humano"
              stroke={paleta[0]}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
            {temIa ? (
              <Line
                type="monotone"
                dataKey="ia"
                stroke={paleta[1]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Legenda em HTML, com o nome em texto: a cor só marca a série. */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Amostra cor={paleta[0]!} /> {ROTULO_GRUPO.humano}
        </span>
        {temIa ? (
          <span className="flex items-center gap-1.5">
            <Amostra cor={paleta[1]!} /> {ROTULO_GRUPO.ia}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ─── Curva precisão/recall (Calibração) ─────────────────────────────────────

export interface PontoCurvaPR {
  limiar: number
  precisao: number
  recall: number
  f1: number
  apontadas: number
}

/**
 * A curva da calibração de UM item: precisão, recall e F1 por limiar (§5.2), com o
 * limiar escolhido marcado. O tooltip traz `apontadas` — quantas faltas aquele limiar
 * aponta, que é quantas amostras sustentam a precisão naquele ponto. Uma precisão de
 * 100% sobre uma falta apontada é um ponto frágil, e quem vai dar override precisa ver isso.
 *
 * As três curvas dividem o eixo porque as três são frações de 0 a 1 — a mesma unidade.
 */
export function CurvaPR({ curva, limiar }: { curva: PontoCurvaPR[]; limiar: number | null }) {
  const paleta = usePaleta()
  if (curva.length === 0) return null
  const SERIES = [
    { chave: 'precisao', nome: 'Precisão', cor: paleta[0]! },
    { chave: 'recall', nome: 'Recall', cor: paleta[1]! },
    { chave: 'f1', nome: 'F1', cor: paleta[2]! },
  ] as const

  return (
    <div className="space-y-2">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curva} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis
              dataKey="limiar"
              type="number"
              domain={[0, 1]}
              ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              className="text-muted-foreground"
              tickFormatter={(v: number) => v.toFixed(1).replace('.', ',')}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.5, 1]}
              tick={{ fontSize: 10 }}
              width={32}
              stroke="currentColor"
              className="text-muted-foreground"
              tickFormatter={(v: number) => v.toFixed(1).replace('.', ',')}
            />
            <Tooltip
              content={({ payload }) => {
                const d = payload?.[0]?.payload as PontoCurvaPR | undefined
                return d ? (
                  <Dica>
                    <p className="font-medium">Limiar {d.limiar.toFixed(2).replace('.', ',')}</p>
                    <p className="tabular-nums text-muted-foreground">
                      Precisão {pct(d.precisao)} · Recall {pct(d.recall)} · F1 {d.f1.toFixed(2).replace('.', ',')}
                    </p>
                    <p className="tabular-nums text-muted-foreground">
                      {inteiro(d.apontadas)} falta(s) apontada(s) neste ponto
                    </p>
                  </Dica>
                ) : null
              }}
            />
            {SERIES.map((s) => (
              <Line
                key={s.chave}
                type="monotone"
                dataKey={s.chave}
                stroke={s.cor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            {limiar !== null ? (
              <ReferenceLine x={limiar} stroke="currentColor" className="text-muted-foreground" strokeDasharray="4 3" />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {SERIES.map((s) => (
          <span key={s.chave} className="flex items-center gap-1.5">
            <Amostra cor={s.cor} /> {s.nome}
          </span>
        ))}
        {limiar !== null ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 border-l border-dashed border-muted-foreground" /> limiar em uso (
            {limiar.toFixed(2).replace('.', ',')})
          </span>
        ) : null}
      </div>
    </div>
  )
}
