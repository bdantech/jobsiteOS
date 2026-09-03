'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, PhoneCall, RefreshCw, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { gerarPitchLeadAction } from '@/actions/comercial'
import { createClient } from '@/lib/supabase/client'
import { comercialKeys, type PitchDoLeadRow } from './queries'

/**
 * A aba "Pitch": o que dizer nesta ligação, sobre ESTA empresa.
 *
 * ─── POR QUE ELA É A PRIMEIRA ABA ───────────────────────────────────────────
 * O card do funil de reuniões abre para uma coisa: ligar. "Lead" diz em que ponto
 * o lead está, "Empresa" diz o cadastro, "Mensagens" diz o que já se falou — todas
 * úteis DEPOIS de saber o que dizer. O pitch é a resposta da pergunta que se faz ao
 * abrir, e uma resposta que exige um clique a mais é uma resposta que não se lê com
 * o telefone chamando.
 *
 * ─── GERA AO ABRIR, UMA VEZ ─────────────────────────────────────────────────
 * O texto custa uma chamada ao modelo, e a distribuição semanal cria dezenas de
 * leads que ninguém vai trabalhar. Gerar na criação seria pagar para escrever o que
 * não se lê; gerar na primeira abertura cobra exatamente pelos cards que alguém
 * abriu. A segunda abertura é instantânea porque o texto ficou gravado.
 *
 * A geração mora DENTRO da queryFn de propósito: o React Query deduplica chamadas
 * concorrentes da mesma chave, e é isso que impede o StrictMode (que monta o
 * componente duas vezes em dev) de disparar dois pitches — e duas cobranças.
 *
 * ─── LEAD MORTO NÃO GERA ────────────────────────────────────────────────────
 * Um lead encerrado é aberto para revisar o que aconteceu, não para ligar. Escrever
 * um pitch ali é gastar token para preparar uma conversa que ninguém vai ter — mas
 * o botão continua lá, porque reabrir um lead é legítimo e acontece.
 */

async function lerPitch(leadId: string): Promise<PitchDoLeadRow | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sdr_lead_pitches')
    .select('*')
    .eq('lead_id', leadId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as PitchDoLeadRow | null) ?? null
}

/** `pontos` e `jargoes` são `jsonb`: o banco devolve `Json`, e nem todo Json é lista. */
function listaDeTexto(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : []
}

export function AbaPitch({ leadId, vivo }: { leadId: string; vivo: boolean }) {
  const qc = useQueryClient()
  const [regerando, setRegerando] = React.useState(false)

  const pitch = useQuery({
    queryKey: comercialKeys.pitch(leadId),
    queryFn: async () => {
      const existente = await lerPitch(leadId)
      if (existente || !vivo) return existente
      const r = await gerarPitchLeadAction(leadId)
      // Falha de geração não é falha de leitura: quem já tinha um pitch velho
      // continua vendo o velho. Aqui não há velho, então o erro sobe — a tela
      // precisa dizer que não conseguiu, e não fingir que a empresa não tem nada.
      if (!r.ok) throw new Error(r.message)
      return lerPitch(leadId)
    },
    // O texto não muda sozinho: só uma regeração o troca, e ela invalida a chave.
    staleTime: Infinity,
    retry: false,
  })

  async function regerar() {
    setRegerando(true)
    const r = await gerarPitchLeadAction(leadId, true)
    setRegerando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Pitch regerado.')
    void qc.invalidateQueries({ queryKey: comercialKeys.pitch(leadId) })
  }

  if (pitch.isPending) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Montando o pitch com o que a base sabe desta empresa…
        </p>
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    )
  }

  if (pitch.isError) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {pitch.error instanceof Error ? pitch.error.message : 'Não foi possível gerar o pitch.'}
        </p>
        <Button size="sm" variant="outline" onClick={() => void pitch.refetch()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
          Tentar de novo
        </Button>
      </div>
    )
  }

  const p = pitch.data
  if (!p) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Este lead está encerrado, e leads encerrados não geram pitch sozinhos.
        </p>
        <Button size="sm" variant="outline" disabled={regerando} onClick={() => void regerar()}>
          <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
          {regerando ? 'Gerando…' : 'Gerar mesmo assim'}
        </Button>
      </div>
    )
  }

  const pontos = listaDeTexto(p.pontos)
  const jargoes = listaDeTexto(p.jargoes)

  return (
    <div className="space-y-4 text-sm">
      {/* A abertura é a única parte que se lê em voz alta — e é a única com moldura. */}
      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <PhoneCall className="h-3 w-3" aria-hidden />
          Abertura — para ler
        </p>
        <p className="leading-relaxed">{p.abertura}</p>
      </div>

      <section className="space-y-1">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Quem é a empresa
        </h4>
        <p className="leading-relaxed text-muted-foreground">{p.contexto}</p>
      </section>

      <section className="space-y-1">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Por que interessa a ela
        </h4>
        <p className="leading-relaxed text-muted-foreground">{p.angulo}</p>
      </section>

      {p.persona ? (
        <section className="space-y-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Com quem falar
          </h4>
          <p className="leading-relaxed text-muted-foreground">{p.persona}</p>
        </section>
      ) : null}

      {pontos.length > 0 ? (
        <section className="space-y-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Levantar durante a ligação
          </h4>
          <ul className="space-y-1.5">
            {pontos.map((ponto, i) => (
              <li key={i} className="flex gap-2 leading-relaxed">
                <span className="mt-[3px] text-[10px] tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <span>{ponto}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {jargoes.length > 0 ? (
        <section className="space-y-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Como se fala por lá
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {jargoes.map((j) => (
              <Badge key={j} variant="outline" className="font-normal">
                {j}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {/*
        A procedência fica junto do texto, não numa página de ajuda: a diferença
        entre "o sistema apurou" e "um modelo escreveu a partir do que a base tinha"
        muda o quanto o SDR aposta numa frase durante a ligação.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
        <span>
          Escrito por IA a partir da nossa base em{' '}
          {new Date(p.gerado_em).toLocaleDateString('pt-BR')}. Confirme na ligação: o dossiê pode
          estar desatualizado.
        </span>
        <Button size="sm" variant="ghost" disabled={regerando} onClick={() => void regerar()}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${regerando ? 'animate-spin' : ''}`} aria-hidden />
          {regerando ? 'Regerando…' : 'Regerar'}
        </Button>
      </div>
    </div>
  )
}
