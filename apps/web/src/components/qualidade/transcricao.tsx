'use client'

import * as React from 'react'
import { Search } from 'lucide-react'
import type { SegmentoTranscricao } from '@jobsiteos/core'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A transcrição inteira, com busca.
 *
 * Uma reunião de uma hora tem ~60 mil caracteres: ninguém lê de ponta a ponta para achar
 * "o que ele disse sobre prazo". A busca FILTRA os trechos e marca o termo — rolar uma
 * parede de texto com o Ctrl+F do navegador acharia o termo também dentro do resumo, da
 * análise e do resto da tela.
 *
 * Os segmentos (falante + tempo) vêm do Fireflies quando existem; sem eles, o texto é
 * quebrado por linha, que é o formato "Quem: fala" que o classificador também lê.
 */

interface Linha {
  falante: string | null
  texto: string
  inicio_s: number | null
}

/** Sem acento e sem caixa: "solucao" acha "Solução". */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function tempo(s: number | null): string | null {
  if (s === null || !Number.isFinite(s)) return null
  const t = Math.max(0, Math.floor(s))
  const m = Math.floor(t / 60)
  const seg = String(t % 60).padStart(2, '0')
  return `${m}:${seg}`
}

function linhasDoTexto(texto: string): Linha[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      // "Fulano: texto" vira falante + fala; uma linha sem dois-pontos curto é só fala.
      const m = /^([^:]{1,60}):\s+(.*)$/.exec(l)
      return m ? { falante: m[1]!, texto: m[2]!, inicio_s: null } : { falante: null, texto: l, inicio_s: null }
    })
}

/** Marca o termo no texto, respeitando acento e caixa do original. */
function Realce({ texto: bruto, termo }: { texto: string; termo: string }) {
  const texto = bruto.normalize('NFC')
  const alvo = normalizar(termo)
  const base = normalizar(texto)
  // A marcação usa as posições do texto normalizado no original; se a normalização mudou
  // o comprimento (caractere raro que vira dois), mostrar sem marca é melhor que marcar errado.
  if (!alvo || base.length !== texto.length) return <>{bruto}</>
  const partes: React.ReactNode[] = []
  let i = 0
  let achou = base.indexOf(alvo, i)
  while (achou >= 0) {
    if (achou > i) partes.push(texto.slice(i, achou))
    partes.push(
      <mark key={achou} className="rounded bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/40">
        {texto.slice(achou, achou + alvo.length)}
      </mark>,
    )
    i = achou + alvo.length
    achou = base.indexOf(alvo, i)
  }
  if (i < texto.length) partes.push(texto.slice(i))
  return <>{partes}</>
}

export function TranscricaoComBusca({
  segmentos,
  texto,
  linhas: linhasProntas,
  alturaClasse = 'max-h-[50vh]',
}: {
  segmentos?: SegmentoTranscricao[] | null
  texto?: string | null
  /** Para quem já tem as falas montadas (ligação). */
  linhas?: Array<{ falante: string | null; texto: string }>
  alturaClasse?: string
}) {
  const [termo, setTermo] = React.useState('')

  const linhas = React.useMemo<Linha[]>(() => {
    if (segmentos && segmentos.length > 0) {
      return segmentos.map((s) => ({ falante: s.falante || null, texto: s.texto, inicio_s: s.inicio_s }))
    }
    if (linhasProntas && linhasProntas.length > 0) return linhasProntas.map((l) => ({ ...l, inicio_s: null }))
    return texto ? linhasDoTexto(texto) : []
  }, [segmentos, texto, linhasProntas])

  const busca = termo.trim()
  const visiveis = React.useMemo(() => {
    if (!busca) return linhas
    const alvo = normalizar(busca)
    return linhas.filter((l) => normalizar(`${l.falante ?? ''} ${l.texto}`).includes(alvo))
  }, [linhas, busca])

  if (linhas.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem texto de transcrição.</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar na transcrição"
            aria-label="Buscar na transcrição"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
          {busca ? `${visiveis.length} de ${linhas.length} trechos` : `${linhas.length} trechos`}
        </span>
      </div>

      <ol className={cn('space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/20 p-2.5 pr-1.5', alturaClasse)}>
        {visiveis.map((l, i) => (
          <li key={i} className="text-xs leading-relaxed">
            {tempo(l.inicio_s) ? (
              <span className="mr-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {tempo(l.inicio_s)}
              </span>
            ) : null}
            {l.falante ? (
              <span className="mr-1 font-medium">
                <Realce texto={l.falante} termo={busca} />:
              </span>
            ) : null}
            <span className="whitespace-pre-wrap break-words">
              <Realce texto={l.texto} termo={busca} />
            </span>
          </li>
        ))}
        {visiveis.length === 0 ? (
          <li className="py-4 text-center text-xs text-muted-foreground">Nenhum trecho com “{busca}”.</li>
        ) : null}
      </ol>
    </div>
  )
}
