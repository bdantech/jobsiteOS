import { supabase } from './supabase'

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

if (!baseUrl) {
  throw new Error(
    'EXPO_PUBLIC_API_BASE_URL é obrigatória. Copie apps/mobile/.env.example para apps/mobile/.env.',
  )
}

export const API_BASE_URL = baseUrl.replace(/\/$/, '')

/** Thrown by api(); carries the HTTP status and whatever the route sent back. */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function isErrorBody(body: unknown): body is { error: string } {
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
}

async function authHeaders(): Promise<Record<string, string>> {
  // getSession() refreshes an expired token before handing it over, so we never
  // send a stale JWT. Expo has no cookie jar — the bearer header IS the session.
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Raw request against the Next.js backend (which is the mobile API: /api/ai,
 * /api/push, admin endpoints). Returns the Response untouched — use this for
 * streaming (the AI chat sheet reads response.body), and `api()` for JSON.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(await authHeaders())) {
    headers.set(key, value)
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(`${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers,
  })
}

/** JSON request/response. Throws ApiError on a non-2xx, so callers can just await. */
export async function api<TResponse>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<TResponse> {
  const { body, ...rest } = init

  const response = await apiFetch(path, {
    ...rest,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!response.ok) {
    const message = isErrorBody(parsed)
      ? parsed.error
      : `Falha na requisição (${response.status}).`
    throw new ApiError(message, response.status, parsed)
  }

  return parsed as TResponse
}
