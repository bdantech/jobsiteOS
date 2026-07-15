import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

/**
 * SecureStore refuses values over 2048 bytes — and it does it *silently* on iOS
 * in release builds, which shows up as "user is randomly logged out on a real
 * device". A Supabase session (access JWT + refresh token + user object, with
 * app_metadata) routinely lands between 2 and 4 KB, and grows with every custom
 * claim, so this is not an edge case: it is the default path.
 *
 * So: chunk it. `<key>` holds a manifest (`__chunks__:<n>`), `<key>.0…<n-1>`
 * hold the slices. A legacy plain value stored under `<key>` still reads back
 * fine, so this is a drop-in over any earlier adapter.
 */

// 2048 is the documented byte ceiling. Chunks are sliced by UTF-16 code unit,
// and a session is base64/JWT (ASCII) plus a mostly-ASCII user object, but a
// name like "João" costs 2 bytes — 1500 leaves a wide margin even if every
// character were 4 bytes at the tail.
const CHUNK_SIZE = 1500
const MANIFEST_PREFIX = '__chunks__:'
// Bound the cleanup scan when the manifest itself is gone (interrupted write).
const MAX_CHUNKS = 64

const chunkKey = (key: string, index: number): string => `${key}.${index}`

async function getChunkCount(key: string): Promise<number | null> {
  const head = await SecureStore.getItemAsync(key)
  if (head === null || !head.startsWith(MANIFEST_PREFIX)) return null
  const count = Number.parseInt(head.slice(MANIFEST_PREFIX.length), 10)
  return Number.isFinite(count) && count > 0 ? count : null
}

async function secureGet(key: string): Promise<string | null> {
  const head = await SecureStore.getItemAsync(key)
  if (head === null) return null
  if (!head.startsWith(MANIFEST_PREFIX)) return head // unchunked / legacy value

  const count = await getChunkCount(key)
  if (count === null) return null

  const parts = await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i))),
  )

  // A missing slice means a torn write: better no session (→ re-login) than a
  // truncated JSON blob that throws inside gotrue on every request.
  if (parts.some((p) => p === null)) {
    await secureRemove(key)
    return null
  }

  return parts.join('')
}

async function secureSet(key: string, value: string): Promise<void> {
  const previousCount = await getChunkCount(key)

  const chunks: string[] = []
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE))
  }

  await Promise.all(
    chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk)),
  )
  // Manifest last: until it lands, the old value is still the one that reads.
  await SecureStore.setItemAsync(key, `${MANIFEST_PREFIX}${chunks.length}`)

  // Shrink: drop slices the previous, longer value left behind.
  if (previousCount !== null && previousCount > chunks.length) {
    await Promise.all(
      Array.from({ length: previousCount - chunks.length }, (_, i) =>
        SecureStore.deleteItemAsync(chunkKey(key, chunks.length + i)),
      ),
    )
  }
}

async function secureRemove(key: string): Promise<void> {
  const count = await getChunkCount(key)
  // No manifest (or a corrupt one): sweep a bounded range so an interrupted
  // write can't leave slices of a stale session sitting in the keychain.
  const toDelete = count ?? MAX_CHUNKS

  await Promise.all(
    Array.from({ length: toDelete }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i))),
  )
  await SecureStore.deleteItemAsync(key)
}

export interface SupabaseStorageAdapter {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

/**
 * SecureStore is native-only (Keychain / Keystore). On web — where this app only
 * ever runs from `expo start --web` for a quick look — fall back to AsyncStorage
 * so the client doesn't blow up on import.
 */
export const secureStorage: SupabaseStorageAdapter =
  Platform.OS === 'web'
    ? {
        getItem: (key) => AsyncStorage.getItem(key),
        setItem: (key, value) => AsyncStorage.setItem(key, value),
        removeItem: (key) => AsyncStorage.removeItem(key),
      }
    : {
        getItem: secureGet,
        setItem: secureSet,
        removeItem: secureRemove,
      }
