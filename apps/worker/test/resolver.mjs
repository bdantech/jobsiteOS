import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * TEST-ONLY module resolver: mapeia `./x.js` → `./x.ts` quando o `.js` não existe.
 *
 * O código de `packages/core` importa com extensão `.js` porque é o que
 * `moduleResolution: NodeNext` exige — e é assim que ele funciona depois de
 * compilado (apps/worker roda o `dist`). Mas `node --experimental-strip-types`
 * roda o `.ts` DIRETO e não reescreve especificadores: um `import './schemas.js'`
 * dentro de um `.ts` estoura com ERR_MODULE_NOT_FOUND.
 *
 * Sem este hook, só arquivos SEM import local seriam testáveis (era o caso de
 * filters.ts, que importa apenas zod) — o que na prática significaria não testar
 * nada que dependa de outro módulo do pacote.
 *
 * O `existsSync` primeiro é deliberado: se um dia houver um `.js` de verdade ao
 * lado, ele ganha. Este hook adiciona um fallback, não sequestra a resolução.
 */
export function resolve(specifier, context, nextResolve) {
  const relativo = specifier.startsWith('./') || specifier.startsWith('../')

  if (relativo && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
    const base = dirname(fileURLToPath(context.parentURL))
    const comoJs = resolvePath(base, specifier)

    if (!existsSync(comoJs)) {
      const comoTs = `${comoJs.slice(0, -3)}.ts`
      if (existsSync(comoTs)) {
        return nextResolve(pathToFileURL(comoTs).href, context)
      }
    }
  }

  return nextResolve(specifier, context)
}
