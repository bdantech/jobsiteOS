'use client'

import * as React from 'react'
import { VARIAVEIS_MENSAGEM, variavelEhAutomatica } from '@jobsiteos/core'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * O CAMPO QUE OFERECE AS VARIÁVEIS (§5). Digite `/` e a lista aparece.
 *
 * ── POR QUE `/` E NÃO `@` ──────────────────────────────────────────────────
 * `@` é, em todo lugar, "mencionar uma pessoa" — e três das chaves aqui são
 * nomes de pessoas. Quem digitasse `@` esperando o contato receberia uma lista de
 * campos. `/` é o gesto de "inserir uma coisa" desde o Notion e o Slack, e não
 * disputa significado com nada.
 *
 * ── POR QUE ISTO SUBSTITUI DECORAR A CHAVE ─────────────────────────────────
 * `{qtd_notas}` só funciona escrito exatamente assim. Quem escrevia `{qtdNotas}`
 * ou `{quantidade_notas}` só descobria o erro no aviso de chave desconhecida, e
 * só se olhasse. Escolher da lista torna o erro de digitação impossível — e é por
 * isso que a lista mostra a DESCRIÇÃO, não só a chave: a pergunta de quem escreve
 * é "o que entra aqui", não "como se soletra".
 *
 * As chaves marcadas "à mão" não têm fonte no sistema: ninguém as preenche, e um
 * texto com elas será recusado no envio. Dizer isso na hora da escolha é o único
 * momento em que a informação ainda evita trabalho jogado fora.
 */

type Opcao = { chave: string; descricao: string; automatica: boolean }

const OPCOES: Opcao[] = Object.entries(VARIAVEIS_MENSAGEM).map(([chave, descricao]) => ({
  chave,
  descricao,
  automatica: variavelEhAutomatica(chave),
}))

export function CampoComVariaveis({
  value,
  onChange,
  multiline = false,
  rows,
  placeholder,
  className,
}: {
  value: string
  onChange: (valor: string) => void
  multiline?: boolean
  rows?: number
  placeholder?: string
  className?: string
}) {
  const ref = React.useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  // `null` é menu fechado. `inicio` é o índice do `/` que o abriu — guardá-lo é o
  // que permite trocar `/qtd` inteiro pela chave, e não só colar depois dele.
  const [gatilho, setGatilho] = React.useState<{ inicio: number; busca: string } | null>(null)
  const [destaque, setDestaque] = React.useState(0)

  const filtradas = React.useMemo(() => {
    if (!gatilho) return []
    const t = normalizar(gatilho.busca)
    if (t === '') return OPCOES
    return OPCOES.filter((o) => normalizar(`${o.chave} ${o.descricao}`).includes(t))
  }, [gatilho])

  React.useEffect(() => setDestaque(0), [gatilho?.busca])

  function aoDigitar(texto: string, caret: number) {
    onChange(texto)
    setGatilho(detectarGatilho(texto, caret))
  }

  function inserir(chave: string) {
    const el = ref.current
    if (!el || !gatilho) return
    const caret = el.selectionStart ?? value.length
    const antes = value.slice(0, gatilho.inicio)
    const depois = value.slice(caret)
    const inserido = `{${chave}}`
    onChange(`${antes}${inserido}${depois}`)
    setGatilho(null)
    // O cursor DEPOIS da chave, para a frase continuar de onde parou. Sem isto ele
    // volta para o fim do texto e a pessoa escreve o resto no lugar errado.
    const pos = antes.length + inserido.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (!gatilho || filtradas.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDestaque((d) => (d + 1) % filtradas.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestaque((d) => (d - 1 + filtradas.length) % filtradas.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Enter aqui é ESCOLHER, não quebrar linha: com a lista aberta é a única
      // coisa que ele pode significar.
      e.preventDefault()
      inserir(filtradas[destaque]!.chave)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setGatilho(null)
    }
  }

  const comum = {
    ref,
    value,
    placeholder,
    onKeyDown: aoTeclar,
    // Clicar noutro ponto do texto sai do gatilho: o `/` que o abriu pode ter
    // ficado longe do cursor, e completar ali apagaria o texto do meio.
    onBlur: () => setTimeout(() => setGatilho(null), 120),
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const el = e.currentTarget
      setGatilho(detectarGatilho(el.value, el.selectionStart ?? 0))
    },
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) =>
      aoDigitar(e.target.value, e.target.selectionStart ?? e.target.value.length),
  }

  return (
    <div className={cn('relative', className)}>
      {multiline ? (
        <Textarea {...(comum as React.ComponentProps<typeof Textarea>)} rows={rows ?? 8} />
      ) : (
        <Input {...(comum as React.ComponentProps<typeof Input>)} className="h-9" />
      )}

      {gatilho ? (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {filtradas.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Nenhuma variável com “{gatilho.busca}”.
            </p>
          ) : (
            filtradas.map((o, i) => (
              <button
                key={o.chave}
                type="button"
                // `onMouseDown` e não `onClick`: o clique só chega depois do blur,
                // que já teria fechado a lista debaixo do dedo.
                onMouseDown={(e) => {
                  e.preventDefault()
                  inserir(o.chave)
                }}
                onMouseEnter={() => setDestaque(i)}
                className={cn(
                  'flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-xs',
                  i === destaque ? 'bg-accent text-accent-foreground' : '',
                )}
              >
                <span className="flex items-center gap-1.5">
                  <code className="font-medium">{`{${o.chave}}`}</code>
                  {!o.automatica ? (
                    <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">à mão</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">{o.descricao}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * O `/` que abre a lista é o que começa uma palavra — início do texto, depois de
 * espaço ou de quebra de linha. Um `/` no meio de `24/09` ou de uma URL não abre
 * nada, que é a diferença entre um atalho e um estorvo.
 */
function detectarGatilho(texto: string, caret: number): { inicio: number; busca: string } | null {
  const ate = texto.slice(0, caret)
  const m = /(^|[\s\n])\/([\p{L}\p{N}_]*)$/u.exec(ate)
  if (!m) return null
  return { inicio: caret - m[2]!.length - 1, busca: m[2]! }
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
