import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'

/**
 * Recusa builtin do Node em qualquer arquivo alcançável a partir do barril.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * Em 02/09/2026 um `export * from './midia-whatsapp.js'` — um arquivo que importa
 * `node:crypto` para decifrar áudio do WhatsApp — entrou no `src/transportes/index.ts`.
 * Typecheck limpo, lint limpo, 941 testes verdes. O build da Vercel morreu com
 * `UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins`, porque
 * o barril do core é importado por componente de cliente e o webpack do Next tentou
 * pôr um builtin do Node dentro do bundle do browser.
 *
 * Nenhuma das três ferramentas que rodamos antes de empurrar consegue ver isso: para
 * o tsc o import é válido, e o problema só existe no bundler. O sinal chega depois do
 * push, no deploy — que é o pior lugar possível.
 *
 * A convenção que evita: o que toca builtin do Node mora em `src/server/`, que o
 * barril NÃO reexporta (é onde já estão `notify` e o HMAC do crédito). Este script
 * anda o grafo a partir de `src/index.ts` e torna a violação impossível de passar.
 *
 * `import type` não conta: o TypeScript apaga a linha, e nada chega ao bundle.
 */

const RAIZ = new URL('../src/', import.meta.url).pathname
const ENTRADA = resolve(RAIZ, 'index.ts')

/** `from 'x'`, `import 'x'` e `require('x')` — capturando o especificador. */
const IMPORTES = /(?:from\s*|import\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
/** A linha inteira é um import de TIPO? Então some na compilação. */
const SO_TIPO = /^\s*(?:import|export)\s+type\s/

function resolverRelativo(deQual, especificador) {
  const base = resolve(dirname(deQual), especificador)
  // O fonte usa `.js` nos imports (ESM), mas o arquivo em disco é `.ts`.
  for (const tentativa of [base.replace(/\.js$/, '.ts'), `${base}.ts`, resolve(base, 'index.ts')]) {
    if (existsSync(tentativa)) return tentativa
  }
  return null
}

const vistos = new Set()
const infracoes = []

function andar(arquivo) {
  if (vistos.has(arquivo)) return
  vistos.add(arquivo)

  const fonte = readFileSync(arquivo, 'utf8')
  for (const linha of fonte.split('\n')) {
    if (SO_TIPO.test(linha)) continue
    for (const m of linha.matchAll(IMPORTES)) {
      const alvo = m[1]
      if (alvo.startsWith('node:')) {
        infracoes.push({ arquivo: relative(RAIZ, arquivo), alvo })
        continue
      }
      if (!alvo.startsWith('.')) continue
      const proximo = resolverRelativo(arquivo, alvo)
      if (proximo) andar(proximo)
    }
  }
}

andar(ENTRADA)

if (infracoes.length > 0) {
  console.error(
    '\nO barril do core (src/index.ts) alcança builtin do Node. Isso quebra o build da web\n' +
      'com UnhandledSchemeError, e nem typecheck nem lint enxergam:\n',
  )
  for (const i of infracoes) console.error(`  ${i.arquivo} → ${i.alvo}`)
  console.error(
    '\nMova o arquivo para src/server/ (que o barril não reexporta) e importe-o por\n' +
      'caminho direto de quem roda no servidor — worker, route handler, server action.\n' +
      'Se o import for só de tipo, escreva `import type` e ele deixa de contar.\n',
  )
  process.exit(1)
}
