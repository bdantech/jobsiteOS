'use client'

import { Building2, Hammer, Landmark, Layers, MapPin, Ruler, Rocket } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatCapital, formatInteiro, formatM2 } from './format'
import type { MetricasGrupo } from './queries'

function Metrica({
  icone: Icone,
  label,
  valor,
  detalhe,
}: {
  icone: LucideIcon
  label: string
  valor: string
  detalhe?: string
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icone className="h-4 w-4" aria-hidden />
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <p className="text-2xl font-semibold tabular-nums">{valor}</p>
        {detalhe && <p className="text-xs text-muted-foreground">{detalhe}</p>}
      </CardContent>
    </Card>
  )
}

export function GrupoMetricas({ metricas }: { metricas: MetricasGrupo }) {
  const ufs = metricas.ufs

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          icone={Building2}
          label="Empresas"
          valor={formatInteiro(metricas.empresas_total)}
          detalhe="CNPJs no grupo"
        />
        <Metrica
          icone={Layers}
          label="SPEs"
          valor={formatInteiro(metricas.spes_total)}
          detalhe="No total"
        />
        <Metrica
          icone={Rocket}
          label="SPEs em 24m"
          valor={formatInteiro(metricas.spes_24m)}
          detalhe="Velocidade de lançamento"
        />
        <Metrica
          icone={Landmark}
          label="Capital agregado"
          valor={formatCapital(metricas.capital_agregado)}
          detalhe="Soma do capital social"
        />
        <Metrica
          icone={MapPin}
          label="UFs"
          valor={formatInteiro(ufs.length)}
          detalhe={ufs.length > 0 ? ufs.join(', ') : 'Sem UF conhecida'}
        />
        <Metrica
          icone={Hammer}
          label="Obras ativas"
          valor={formatInteiro(metricas.obras_ativas)}
          detalhe="CNO — situação ativa"
        />
        <Metrica
          icone={Ruler}
          label="m² em execução"
          valor={formatM2(metricas.m2_em_execucao)}
          detalhe="Metragem das obras ativas"
        />
      </div>

      {/* Números derivados não são números do worker, e a tela não pode fingir que são. */}
      {metricas.fonte === 'derivada' && (
        <p className="text-xs text-muted-foreground">
          O worker ainda não calculou as métricas deste grupo. Os números acima foram somados a
          partir das empresas listadas abaixo e podem estar incompletos.
        </p>
      )}
    </section>
  )
}
