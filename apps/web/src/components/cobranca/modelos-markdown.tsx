import * as React from 'react'

/**
 * Markdown MÍNIMO para a pré-visualização dos modelos: títulos (#, ##, ###), negrito,
 * itálico, listas, tabelas GFM, regra horizontal e parágrafos. É a gramática que os
 * modelos de notificação e de confissão usam — o PDF de verdade sai do worker, com a
 * stack do report; aqui é só para o gestor ver a carta antes de gravar a versão.
 *
 * Sem `dangerouslySetInnerHTML`: o corpo é texto que um gestor digitou, e virar nó
 * React a partir dele fecha a porta de HTML injetado sem precisar de sanitizador.
 * O repo não tem react-markdown (o parecer do Crédito e o do Jurídico fazem o mesmo).
 */

function inline(texto: string, chave: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let ultimo = 0
  let i = 0
  for (const m of texto.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > ultimo) out.push(texto.slice(ultimo, idx))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={`${chave}-b${i++}`}>{tok.slice(2, -2)}</strong>)
    else out.push(<em key={`${chave}-i${i++}`}>{tok.slice(1, -1)}</em>)
    ultimo = idx + tok.length
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo))
  return out
}

const celulas = (linha: string) =>
  linha
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

const ehSeparadorTabela = (linha: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(linha)

export function MarkdownSimples({ texto }: { texto: string }) {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n')
  const blocos: React.ReactNode[] = []
  let i = 0
  let k = 0

  while (i < linhas.length) {
    const l = linhas[i]!
    if (!l.trim()) {
      i++
      continue
    }

    const titulo = /^(#{1,4})\s+(.*)$/.exec(l)
    if (titulo) {
      const nivel = titulo[1]!.length
      const cls =
        nivel === 1
          ? 'mt-4 text-lg font-semibold'
          : nivel === 2
            ? 'mt-4 text-base font-semibold'
            : 'mt-3 text-sm font-semibold'
      const Tag = (`h${Math.min(nivel + 1, 6)}` as 'h2' | 'h3' | 'h4' | 'h5')
      blocos.push(
        <Tag key={k++} className={cls}>
          {inline(titulo[2]!, `h${k}`)}
        </Tag>,
      )
      i++
      continue
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      blocos.push(<hr key={k++} className="my-3 border-border" />)
      i++
      continue
    }

    if (l.trim().startsWith('|') && i + 1 < linhas.length && ehSeparadorTabela(linhas[i + 1]!)) {
      const cab = celulas(l)
      const alin = celulas(linhas[i + 1]!).map((c) => (c.endsWith(':') ? 'text-right' : 'text-left'))
      i += 2
      const corpo: string[][] = []
      while (i < linhas.length && linhas[i]!.trim().startsWith('|')) {
        corpo.push(celulas(linhas[i]!))
        i++
      }
      const t = k++
      blocos.push(
        <div key={t} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {cab.map((c, j) => (
                  <th key={j} className={`border border-border bg-muted/50 px-2 py-1 font-medium ${alin[j] ?? ''}`}>
                    {inline(c, `th${t}-${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corpo.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className={`border border-border px-2 py-1 tabular-nums ${alin[j] ?? ''}`}>
                      {inline(c, `td${t}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordenada = /^\s*\d+\./.test(l)
      const itens: string[] = []
      while (i < linhas.length && /^\s*([-*]|\d+\.)\s+/.test(linhas[i]!)) {
        itens.push(linhas[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ''))
        i++
      }
      const t = k++
      const Lista = ordenada ? 'ol' : 'ul'
      blocos.push(
        <Lista key={t} className={`my-2 space-y-1 pl-5 ${ordenada ? 'list-decimal' : 'list-disc'}`}>
          {itens.map((it, j) => (
            <li key={j}>{inline(it, `li${t}-${j}`)}</li>
          ))}
        </Lista>,
      )
      continue
    }

    // Parágrafo: junta linhas até a próxima em branco ou o próximo bloco.
    // A primeira linha entra sempre: uma linha com "|" que não abre tabela cairia fora
    // de todos os ramos e o laço não andaria.
    const par: string[] = [l.trim()]
    i++
    while (
      i < linhas.length &&
      linhas[i]!.trim() &&
      !/^(#{1,4})\s+/.test(linhas[i]!) &&
      !linhas[i]!.trim().startsWith('|') &&
      !/^\s*([-*]|\d+\.)\s+/.test(linhas[i]!)
    ) {
      par.push(linhas[i]!.trim())
      i++
    }
    const t = k++
    blocos.push(
      <p key={t} className="my-2 leading-relaxed">
        {par.map((p, j) => (
          <React.Fragment key={j}>
            {j > 0 ? <br /> : null}
            {inline(p, `p${t}-${j}`)}
          </React.Fragment>
        ))}
      </p>,
    )
  }

  return <div className="text-sm">{blocos}</div>
}
