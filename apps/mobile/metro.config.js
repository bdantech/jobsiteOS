/* eslint-env node */
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const projectRoot = __dirname

const config = getDefaultConfig(projectRoot)

// ─── O que NÃO está mais aqui ───────────────────────────────────────────────
// Até o SDK 52 este arquivo carregava três overrides de monorepo pnpm:
// `watchFolders` apontando para a raiz do repo (senão packages/core, consumido
// como fonte TypeScript, nunca era lido nem recarregado), `nodeModulesPaths` com
// as duas pastas de módulos, e `unstable_enableSymlinks`.
//
// O @expo/metro-config do SDK 57 descobre o workspace sozinho: já devolve as
// cinco pastas do pnpm-workspace em watchFolders (packages/core incluído), já
// devolve os dois nodeModulesPaths, e symlinks passaram a ser padrão — a flag
// nem existe mais. Repetir isso à mão hoje só PIORA: atribuir watchFolders
// substitui a lista descoberta em vez de somar a ela. O expo-doctor reclama dos
// três, e com razão.
//
// O que continua valendo é a advertência sobre `disableHierarchicalLookup: true`
// — o conselho que se acha em guias de monorepo npm/yarn. Sob pnpm ele quebra
// tudo: a busca hierárquica para cima é o único caminho pelo qual um pacote
// dentro do .pnpm store alcança as próprias dependências. O padrão do Expo é
// `false`. Deixe assim.

// ─── 1. packages/core é TypeScript ESM ──────────────────────────────────────
// Os imports relativos dele carregam a extensão `.js` que o resolvedor ESM do
// Node exige ('./registry/index.js'), enquanto o arquivo em disco é `.ts`. O tsc
// entende essa reescrita; o Metro não. O remap vale SÓ para especificadores
// nascidos dentro de packages/core, para que um `.js` de verdade em qualquer
// outra dependência continue resolvendo normalmente.
const CORE_SRC = `${path.sep}packages${path.sep}core${path.sep}`

// ─── 2. `ws` ────────────────────────────────────────────────────────────────
// O WebSocket de Node entra no grafo por @supabase/realtime-js — e puxa
// `stream`, que não existe no React Native.
//
// Em runtime esse ramo NUNCA executa: o RealtimeClient testa
// `typeof WebSocket !== 'undefined'`, o React Native tem WebSocket global, e o
// `require('ws')` mora no else. É código morto aqui. Mas o Metro resolve
// estaticamente, e código morto também precisa resolver.
//
// Até o SDK 52 passava sozinho: o Metro ignorava o campo `exports` dos pacotes e
// caía no mainField `browser`, que o `ws` aponta para um stub. No SDK 57
// `unstable_enablePackageExports` vem LIGADO, o `exports` do `ws` passa a mandar,
// e sem a condição `browser` ele entrega o `index.js` de Node.
//
// A saída que se encontra por aí é desligar package exports no app inteiro. Isso
// é um machado: quebra qualquer dependência que só publique `exports`. Como o
// problema é de um pacote só, a condição `browser` é aplicada A ELE, abaixo.
const WS_BROWSER_CONDITION = { unstable_conditionNames: ['browser'] }

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws') {
    return context.resolveRequest({ ...context, ...WS_BROWSER_CONDITION }, moduleName, platform)
  }

  const origin = context.originModulePath ?? ''
  const isRelative = moduleName.startsWith('./') || moduleName.startsWith('../')

  if (origin.includes(CORE_SRC) && isRelative && moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(context, `${moduleName.slice(0, -3)}.ts`, platform)
    } catch {
      // Fall through: it really was a .js file.
    }
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = withNativeWind(config, { input: './global.css' })
