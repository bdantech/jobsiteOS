// Shared surface for apps/web, apps/mobile and apps/worker.
// NOTE: server-only code (notify) lives under ./server and is NOT re-exported
// here — importing it from a client bundle would pull web-push/expo-server-sdk
// into the browser and, worse, imply a service-role client is available.

export * from './registry/index.js'
export * from './schemas/index.js'
export * from './db/mutations.js'
export * from './db/config.js'
export * from './mercado/index.js'
export * from './radar/index.js'
export * from './antecipacao/index.js'
export * from './certificados/index.js'
export * from './leads/index.js'
export * from './credito/index.js'
export * from './campanhas/index.js'
export * from './comercial/index.js'
export * from './comunicacao/index.js'
export * from './fornecedores/index.js'
export * from './perfil/index.js'
export * from './juridico/index.js'
export * from './reports/index.js'
export * from './crons/index.js'
export * from './transportes/index.js'
export * from './constants.js'
export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Views,
} from './types/database.js'
