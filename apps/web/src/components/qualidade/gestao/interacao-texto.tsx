'use client'

import * as React from 'react'
import { estadoDaLigacao, textoDaMensagem, type AnaliseDetalhe } from '@jobsiteos/core'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { dataHora } from './formato'

/**
 * O TEXTO da interação, como o classificador o lê — para o gestor rotular lendo a mesma
 * coisa que o modelo leu.
 *
 * Só o texto cru: nem resumo, nem próximos passos detectados, nem nota. Qualquer coisa
 * que já seja uma conclusão sobre a conversa ancora o rótulo, e um rótulo ancorado na
 * saída de um modelo não serve para medir esse modelo.
 *
 * A busca destaca as linhas que contêm o termo em vez de esconder as outras: rotular
 * "tratou a objeção?" exige ler o que veio antes e depois da objeção.
 */
export function InteracaoTexto({ d }: { d: AnaliseDetalhe }) {
  const [busca, setBusca] = React.useState('')
  const linhas = React.useMemo(() => linhasDaInteracao(d), [d])
  const termo = busca.trim().toLowerCase()
  const achadas = termo ? linhas.filter((l) => l.texto.toLowerCase().includes(termo)).length : 0

  if (linhas.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        O texto desta interação não está disponível — a transcrição pode ter sido expurgada pela regra de
        retenção (a análise sobrevive ao texto). Sem o texto, não dá para rotular: escolha outra interação.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar no texto…"
          aria-label="Buscar no texto da interação"
          className="h-8"
        />
        {termo ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{achadas} linha(s)</span> : null}
      </div>
      <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3 text-sm">
        {linhas.map((l, i) => {
          const casa = termo && l.texto.toLowerCase().includes(termo)
          return (
            <li key={i} className={cn('rounded px-1.5 py-0.5', casa && 'bg-amber-100 dark:bg-amber-900/40')}>
              {l.quem ? (
                <span className={cn('mr-1 font-medium', l.nosso ? 'text-foreground' : 'text-muted-foreground')}>
                  {l.quem}:
                </span>
              ) : null}
              {l.quando ? <span className="mr-1 text-xs text-muted-foreground">[{l.quando}]</span> : null}
              <span className="whitespace-pre-wrap">{l.texto}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

interface Linha {
  quem: string | null
  quando: string | null
  texto: string
  nosso: boolean
}

function linhasDaInteracao(d: AnaliseDetalhe): Linha[] {
  const i = d.interacao
  if (!i) return []

  if (d.analise.escopo === 'janela_conversa') {
    return (i.mensagens ?? [])
      .filter((m) => (m.corpo ?? m.assunto ?? '').trim())
      .map((m) => ({
        quem: m.direcao === 'entrada' ? 'Cliente' : `Vendedor${m.por_ia ? ' (IA)' : ''}`,
        quando: dataHora(m.criado_em),
        texto: [m.assunto ? `[${m.assunto}]` : null, (textoDaMensagem(m) ?? '').trim()].filter(Boolean).join(' '),
        nosso: m.direcao === 'saida',
      }))
  }

  // Ligação: o mesmo leitor de turnos que monta o estado enviado ao classificador.
  const texto = d.analise.escopo === 'ligacao' ? estadoDaLigacao(i.turnos) : (i.texto ?? '')
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      // "Fulano: fala" — separa o falante quando a linha tem esse formato.
      const m = /^([^:]{1,60}):\s(.*)$/.exec(l)
      if (!m) return { quem: null, quando: null, texto: l, nosso: false }
      const quem = m[1]!.trim()
      return { quem, quando: null, texto: m[2]!, nosso: /vendedor|ia\)/i.test(quem) }
    })
}
