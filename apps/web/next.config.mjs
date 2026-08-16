/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @jobsiteos/core ships raw TypeScript (main: ./src/index.ts) rather than a
  // build artifact, so Next must compile it alongside the app.
  transpilePackages: ['@jobsiteos/core'],
  experimental: {
    // Server Actions are used for every mutation; the default 1mb body limit is
    // fine, but we pin it so a future note/attachment doesn't silently 413.
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  /*
   * O snippet embutível é `<script src="/f/{slug}.js">` (04i §4), e essa URL colide
   * com a página standalone `/f/{slug}`: o App Router resolve as duas para o MESMO
   * segmento dinâmico, e uma pasta não pode ter `page.tsx` e `route.ts` ao mesmo
   * tempo. O rewrite desempata pela extensão antes do roteador ver o caminho.
   *
   * A alternativa era mudar a URL do script — mas ela vai colada na landing page do
   * cliente, e um snippet publicado é a coisa mais cara de trocar depois.
   */
  async rewrites() {
    return [{ source: '/f/:slug.js', destination: '/api/f/:slug/script' }]
  },
  webpack: (config) => {
    // @jobsiteos/core is raw ESM TypeScript: its relative imports carry explicit
    // `.js` extensions ("export * from './schemas/index.js'") that actually
    // resolve to `.ts` files on disk. tsc understands that; webpack does not,
    // and fails with "Can't resolve './schemas/index.js'".
    //
    // extensionAlias tells webpack to try .ts/.tsx before .js for a `.js`
    // specifier, which is the standard fix and keeps packages/core untouched.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    }
    return config
  },
}

export default nextConfig
