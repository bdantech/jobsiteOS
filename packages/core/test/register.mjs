import { register } from 'node:module'

/** Ponte para o resolver: `node --import ./test/register.mjs` o instala. */
register('./resolver.mjs', import.meta.url)
