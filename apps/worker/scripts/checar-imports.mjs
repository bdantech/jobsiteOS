import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Recusa `import ... from '@jobsiteos/core'` no fonte do worker.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * Em 17/08/2026 um import pelo nome do pacote passou pelo typecheck, passou pelo build do
 * Docker, e derrubou o container no boot com ERR_MODULE_NOT_FOUND. O healthcheck do
 * Railway falhou três vezes e o deploy foi recusado — sem nenhum sinal antes disso.
 *
 * A razão: o `rootDir` do worker é a RAIZ DO REPO, então o tsc emite
 * `dist/packages/core/...` ao lado de `dist/apps/worker/...`, e é por isso que todo
 * arquivo daqui importa o core por caminho relativo — assim o import resolve dentro do
 * dist. O estágio runner do Dockerfile copia SÓ `apps/worker/dist`; o fonte de
 * packages/core nunca chega ao container. E `@jobsiteos/core` aponta `main` para um
 * `.ts`, que o Node não carrega nem quando o fonte está lá.
 *
 * Ou seja: o import pelo nome do pacote funciona em tudo que não é produção. É o pior
 * tipo de erro que existe, e um `grep` de meio segundo o torna impossível.
 */

const RAIZ = new URL('../src/', import.meta.url).pathname
const PROIBIDO = /from\s+['"]@jobsiteos\/core(\/[^'"]*)?['"]/

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return arquivos(caminho)
    return caminho.endsWith('.ts') ? [caminho] : []
  })
}

const culpados = []
for (const caminho of arquivos(RAIZ)) {
  readFileSync(caminho, 'utf8')
    .split('\n')
    .forEach((linha, i) => {
      if (PROIBIDO.test(linha)) culpados.push(`${caminho.replace(RAIZ, 'src/')}:${i + 1}  ${linha.trim()}`)
    })
}

if (culpados.length > 0) {
  console.error(
    '\n✖ O worker não pode importar `@jobsiteos/core` pelo nome do pacote.\n' +
      '  Ele compila, passa no typecheck, roda em desenvolvimento — e quebra no boot do\n' +
      '  container, porque o runner do Docker só recebe `apps/worker/dist`.\n\n' +
      '  Use o caminho relativo ao fonte, como os outros arquivos:\n' +
      "    import { formatCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'\n",
  )
  for (const c of culpados) console.error(`  ${c}`)
  console.error('')
  process.exit(1)
}
