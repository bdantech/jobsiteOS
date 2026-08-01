'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight, Lightbulb, Loader2, X } from 'lucide-react'
import type { Sugestao } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { registrarSugestaoAction } from '@/actions/perfil'
import { formatInteiro } from '../piramide/constants'
import { simularImpacto } from './impacto'

/**
 * O card de sugestão (§6), na ordem que o prompt fixa: frase simples → evidência
 * → impacto simulado → botão.
 *
 * A ordem não é estética. Se o impacto viesse antes da evidência, a decisão seria
 * tomada pelo tamanho do número ("adiciona 2.400 empresas!") e não pelo que o
 * sustenta. E o botão vem por último de propósito: ele é a única coisa aqui que
 * muda alguma coisa, e chegar até ele exige ter passado pelos outros três.
 *
 * O botão NÃO ativa nada. Ele registra a decisão e abre o editor da regra com o
 * ajuste já no rascunho — daí em diante é o fluxo normal: preview de impacto,
 * depois ativação.
 */

export function SugestaoCard({
  sugestao,
  snapshotId,
  onDecidida,
}: {
  sugestao: Sugestao
  snapshotId: string
  onDecidida: () => void
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = React.useState<'aceitar' | 'descartar' | null>(null)
  const [impacto, setImpacto] = React.useState<string | null>(null)
  const [carregandoImpacto, setCarregandoImpacto] = React.useState(true)

  // O impacto é um dry-run REAL contra a base, não uma estimativa: é o mesmo
  // caminho que o preview do editor usa. Um card que dissesse "≈2.400" e o
  // editor mostrasse 900 destruiria a confiança nos dois.
  React.useEffect(() => {
    let vivo = true
    setCarregandoImpacto(true)
    simularImpacto(sugestao)
      .then((texto) => {
        if (vivo) setImpacto(texto)
      })
      .catch(() => {
        if (vivo) setImpacto(null)
      })
      .finally(() => {
        if (vivo) setCarregandoImpacto(false)
      })
    return () => {
      vivo = false
    }
  }, [sugestao])

  async function decidir(acao: 'aceita' | 'descartada') {
    setOcupado(acao === 'aceita' ? 'aceitar' : 'descartar')
    const r = await registrarSugestaoAction({
      snapshot_id: snapshotId,
      sugestao_id: sugestao.id,
      acao,
    })
    setOcupado(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (acao === 'descartada') {
      toast.success('Sugestão descartada. Ela some da lista; o registro fica no log.')
      onDecidida()
      return
    }
    const destino =
      sugestao.alvo.tipo === 'camada'
        ? `/mercado/piramide?sugestao=${r.data.id}`
        : `/antecipacao/faixas?sugestao=${r.data.id}`
    router.push(destino)
  }

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="text-sm font-medium leading-snug">{sugestao.frase}</p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {sugestao.alvo.tipo === 'camada'
              ? `regra de ${sugestao.alvo.chave.toUpperCase()}`
              : `faixa ${sugestao.alvo.chave}`}
          </Badge>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{sugestao.detalhe}</p>

        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-xs">
          <span className="text-muted-foreground line-through">{sugestao.de}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
          <span className="font-medium">{sugestao.para}</span>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {carregandoImpacto ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Simulando o impacto na base…
            </>
          ) : (
            (impacto ?? 'Não foi possível simular o impacto agora — o editor mostra o preview completo.')
          )}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void decidir('aceita')} disabled={ocupado !== null}>
            {ocupado === 'aceitar' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Criar nova versão com este ajuste
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void decidir('descartada')}
            disabled={ocupado !== null}
          >
            <X className="mr-2 h-4 w-4" aria-hidden />
            Descartar
          </Button>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          O botão abre o editor com o ajuste já aplicado no rascunho. Nada é ativado daqui — o
          preview de impacto e a ativação continuam sendo seus.
        </p>
      </CardContent>
    </Card>
  )
}

export { formatInteiro }
