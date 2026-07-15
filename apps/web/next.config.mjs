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
