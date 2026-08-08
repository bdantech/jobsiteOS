'use client'

import type { Json } from '@jobsiteos/core'

/**
 * A leitura do jsonb de cartórios e o gráfico de evolução no tempo.
 *
 * Mora aqui, e não dentro da ficha da empresa, porque a aba Análise dos clientes
 * Onepay mostra O MESMO gráfico. Duas implementações do mesmo desenho divergiriam na
 * primeira vez que uma das duas ganhasse um ajuste — e a diferença apareceria como
 * "o valor da ficha não bate com o da análise", que é o tipo de discrepância que faz
 * alguém parar de confiar nos dois números.
 */

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brl = (n: number | null | undefined) => moeda.format(Number(n) || 0)

export function parseNumeroBr(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normal.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Duas estruturas do DirectD: SP usa estado.cartoriosProtesto[] + cartório.numProtestos +
 * cartório.nome; Nacional usa estado.cartorios[] + cartório.numeroProtestos e só a cidade
 * (sem nome). Estes helpers normalizam as duas.
 */
export function filhosDoEstado(uf: unknown): unknown[] {
  if (typeof uf !== 'object' || uf === null || Array.isArray(uf)) return []
  const e = uf as Record<string, unknown>
  const lista = e.cartoriosProtesto ?? e.cartorios
  return Array.isArray(lista) ? lista : []
}

export function nomeCidadeCartorio(cc: Record<string, unknown>): {
  nome: string
  cidade: string | null
} {
  const nome = typeof cc.nome === 'string' ? cc.nome : null
  const cidade = typeof cc.cidade === 'string' ? cc.cidade : null
  // Nacional não traz nome: usa a cidade como rótulo e não repete a cidade embaixo.
  return { nome: nome ?? cidade ?? 'Cartório', cidade: nome ? cidade : null }
}

/** DirectD usa dd/mm/aaaa (o dataConsulta vem assim); aceita ISO por garantia. */
export function parseDataProtesto(s: string | null): Date | null {
  if (!s) return null
  const t = s.trim()
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]))
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  return null
}

/** Um protesto individual, achatado de estado → cartório → protesto[]. */
export interface ProtestoItem {
  empresa?: string
  data: Date | null
  dataLabel: string | null
  valor: number
  cartorio: string
  cidade: string | null
}

/**
 * Achata os protestos individuais de um snapshot (cartorios jsonb). Quando o cartório
 * não traz o detalhe protesto[], cai para o total do cartório como uma linha só —
 * assim a soma da lista bate com o valor total mesmo sem o detalhe.
 */
export function extrairProtestos(cartorios: Json | null, empresa?: string): ProtestoItem[] {
  const out: ProtestoItem[] = []
  if (!Array.isArray(cartorios)) return out

  for (const uf of cartorios) {
    for (const c of filhosDoEstado(uf)) {
      if (typeof c !== 'object' || c === null || Array.isArray(c)) continue
      const cc = c as Record<string, unknown>
      const { nome, cidade } = nomeCidadeCartorio(cc)
      // SP: protesto[]; Nacional: titulos[]. Cada item tem dataProtesto + valorProtestado.
      const itens = cc.protesto ?? cc.titulos

      if (Array.isArray(itens) && itens.length > 0) {
        for (const p of itens) {
          if (typeof p !== 'object' || p === null || Array.isArray(p)) continue
          const pp = p as Record<string, unknown>
          const dl = typeof pp.dataProtesto === 'string' ? pp.dataProtesto : null
          out.push({
            empresa,
            data: parseDataProtesto(dl),
            dataLabel: dl,
            valor: parseNumeroBr(pp.valorProtestado) ?? 0,
            cartorio: nome,
            cidade,
          })
        }
      } else {
        const valor = parseNumeroBr(cc.valorTotalProtestosCartorio) ?? 0
        if (valor > 0) out.push({ empresa, data: null, dataLabel: null, valor, cartorio: nome, cidade })
      }
    }
  }

  return out
}

/** Barras verticais do valor protestado por mês. Sem datas → aviso. */
export function GraficoTempoProtestos({ protestos }: { protestos: ProtestoItem[] }) {
  const datados = protestos.filter((p) => p.data)
  if (datados.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem datas de protesto informadas nesta base.</p>
  }

  const buckets = new Map<string, { label: string; valor: number; ord: number }>()
  for (const p of datados) {
    const d = p.data as Date
    const y = d.getFullYear()
    const m = d.getMonth()
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    const label = `${String(m + 1).padStart(2, '0')}/${String(y).slice(2)}`
    const b = buckets.get(key) ?? { label, valor: 0, ord: y * 12 + m }
    b.valor += p.valor
    buckets.set(key, b)
  }

  const ordenados = [...buckets.values()].sort((a, b) => a.ord - b.ord)
  const max = Math.max(...ordenados.map((b) => b.valor), 1)

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      {ordenados.map((b) => (
        <div key={b.label} className="flex w-10 shrink-0 flex-col items-center gap-1">
          <div className="flex h-28 w-full items-end">
            <div
              className="w-full rounded-t bg-primary"
              style={{ height: `${Math.max(3, (b.valor / max) * 100)}%` }}
              title={`${b.label}: ${brl(b.valor)}`}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">{b.label}</span>
        </div>
      ))}
    </div>
  )
}
