import type { ConfigContext, ExpoConfig } from 'expo/config'

/**
 * Dynamic layer on top of app.json.
 *
 * The EAS project id is NOT committed: the operator runs `eas init` once (which
 * creates the project on Expo's servers and prints the id) and then exports
 * EAS_PROJECT_ID — locally in apps/mobile/.env, and in the EAS build profile /
 * CI secrets. Without it, `getExpoPushTokenAsync` cannot mint a push token, so
 * push registration must degrade gracefully rather than crash.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EAS_PROJECT_ID

  return {
    ...config,
    name: config.name ?? 'JobsiteOS',
    slug: config.slug ?? 'jobsiteos',
    extra: {
      ...config.extra,
      eas: projectId ? { projectId } : {},
    },
  }
}
