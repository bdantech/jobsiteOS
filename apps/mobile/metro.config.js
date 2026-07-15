/* eslint-env node */
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// ─── pnpm + monorepo ────────────────────────────────────────────────────────
// 1. Metro only watches the app folder by default, so @jobsiteos/core (which is
//    consumed as TypeScript *source*, not a build artifact) would never be read
//    nor hot-reloaded. Watch the repo root.
config.watchFolders = [workspaceRoot]

// 2. pnpm does not hoist: apps/mobile/node_modules holds only this app's direct
//    dependencies (as symlinks into the root .pnpm store), and each of THOSE
//    packages keeps its own transitive deps in its own nested node_modules.
//    So Metro needs both halves:
//      - nodeModulesPaths, so a module required from anywhere can still find the
//        app's and the workspace's installed packages;
//      - the default hierarchical (upward) walk, which is the ONLY way a package
//        inside the .pnpm store reaches its own dependencies. Setting
//        `disableHierarchicalLookup: true` — the advice you'll find for npm/yarn
//        monorepos — breaks pnpm outright: every transitive import inside a
//        dependency (e.g. @expo/metro-runtime → whatwg-fetch) stops resolving.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.unstable_enableSymlinks = true

// 3. packages/core is ESM TypeScript: its relative imports carry the `.js`
//    extension that Node's ESM resolver demands ('./registry/index.js'), while
//    the file on disk is `.ts`. tsc understands that rewrite; Metro does not.
//    Remap it, but only for specifiers originating inside packages/core, so a
//    genuine `.js` file in any other dependency still resolves normally.
const CORE_SRC = `${path.sep}packages${path.sep}core${path.sep}`

// 4. apps/mobile/tsconfig.json maps `react` -> `./node_modules/@types/react` to
//    force a single React *type* identity across the app and its libraries (two
//    Reacts live in this workspace: RN 18 here, Next 19 on the web app — see the
//    long comment there). Expo hands tsconfig `paths` to Metro as well, so
//    without this block the bundler follows that mapping for the RUNTIME import
//    and dies with "the package @types/react specifies a main module field that
//    could not be resolved" — @types/react is declarations, there is no JS in it.
//
//    So: `react` and its subpaths (`react/jsx-runtime`, …) are resolved here with
//    Node's own resolver, from this app's node_modules, before any alias can be
//    applied. Types stay pinned for tsc; the bundle keeps the real React.
const resolveReal = (moduleName) =>
  require.resolve(moduleName, { paths: [projectRoot] })

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return { type: 'sourceFile', filePath: resolveReal(moduleName) }
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
