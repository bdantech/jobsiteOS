import type { PrefsNotificacoes } from '@jobsiteos/core'
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import {
  buscarPreferencias,
  registrarDispositivo,
  removerDispositivo,
  salvarPreferencias,
} from './api'
import {
  inspecionarAmbientePush,
  nomeDoDispositivo,
  obterTokenPush,
  obterTokenSeConcedido,
  type PushAmbiente,
} from './push'
import { usePushDispositivoStore } from './push-store'

const PREFERENCIAS_KEY = ['preferencias-notificacoes'] as const
const AMBIENTE_PUSH_KEY = ['push-ambiente'] as const

/** The account-wide notification channels. Server-owned (prefs_notificacoes). */
export function usePreferencias(): UseQueryResult<PrefsNotificacoes> {
  return useQuery({
    queryKey: PREFERENCIAS_KEY,
    queryFn: buscarPreferencias,
  })
}

/**
 * Toggling a switch must feel instant, so the cache is updated optimistically
 * and rolled back if the server refuses. The server's reply is authoritative and
 * overwrites the guess.
 */
export function useSalvarPreferencias(): UseMutationResult<
  PrefsNotificacoes,
  Error,
  Partial<PrefsNotificacoes>,
  { anterior: PrefsNotificacoes | undefined }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: salvarPreferencias,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: PREFERENCIAS_KEY })
      const anterior = queryClient.getQueryData<PrefsNotificacoes>(PREFERENCIAS_KEY)

      if (anterior) {
        queryClient.setQueryData<PrefsNotificacoes>(PREFERENCIAS_KEY, { ...anterior, ...patch })
      }

      return { anterior }
    },
    onError: (_error, _patch, context) => {
      if (context?.anterior) {
        queryClient.setQueryData<PrefsNotificacoes>(PREFERENCIAS_KEY, context.anterior)
      }
    },
    onSuccess: (prefs) => {
      queryClient.setQueryData<PrefsNotificacoes>(PREFERENCIAS_KEY, prefs)
    },
  })
}

export interface PushDispositivo {
  ambiente: UseQueryResult<PushAmbiente>
  /** The switch's value: opted in AND the OS still agrees. */
  ativo: boolean
  ativar: UseMutationResult<string, Error, void, unknown>
  desativar: UseMutationResult<void, Error, void, unknown>
  /** True until the persisted opt-in flag has been read back from disk. */
  pronto: boolean
}

/**
 * Push for THIS device: OS permission → Expo token → /api/push/expo.
 *
 * Turning it ON also turns the account-wide `push_mobile` channel on, because a
 * device switch that delivers nothing (notify() checks both) is a lie.
 *
 * Turning it OFF does NOT touch `push_mobile`: that preference is account-wide,
 * and silencing this phone must not silence the user's other phone. It only
 * removes this device's token.
 */
export function usePushDispositivo(): PushDispositivo {
  const queryClient = useQueryClient()

  const optIn = usePushDispositivoStore((state) => state.optIn)
  const tokenLocal = usePushDispositivoStore((state) => state.token)
  const hydrated = usePushDispositivoStore((state) => state.hydrated)
  const marcarAtivo = usePushDispositivoStore((state) => state.marcarAtivo)
  const marcarInativo = usePushDispositivoStore((state) => state.marcarInativo)

  const ambiente = useQuery({
    queryKey: AMBIENTE_PUSH_KEY,
    queryFn: inspecionarAmbientePush,
    // Permission can change in the OS settings while the app sits in the
    // background; never serve a stale answer for it.
    staleTime: 0,
    gcTime: 0,
  })

  const ativar = useMutation<string, Error, void>({
    mutationFn: async () => {
      const token = await obterTokenPush()
      await registrarDispositivo({ token, device: nomeDoDispositivo() })
      await salvarPreferencias({ push_mobile: true })
      return token
    },
    onSuccess: async (token) => {
      marcarAtivo(token)
      await queryClient.invalidateQueries({ queryKey: PREFERENCIAS_KEY })
      await ambiente.refetch()
    },
    onError: async () => {
      // The most common failure is a denied prompt, which changes the
      // environment we just rendered from.
      await ambiente.refetch()
    },
  })

  const desativar = useMutation<void, Error, void>({
    mutationFn: async () => {
      const token = tokenLocal ?? (await obterTokenSeConcedido())
      // No token to remove (permission revoked before we ever registered): the
      // local flag is all there is to clear, and the server has nothing for us.
      if (token) await removerDispositivo(token)
    },
    onSuccess: () => {
      marcarInativo()
    },
  })

  /**
   * Expo tokens rotate — a reinstall, a restore to a new phone, sometimes an OS
   * update. A user who opted in once would then silently stop receiving pushes,
   * with the switch still showing "on". So re-register once per mount whenever
   * the switch is on and the OS still agrees. Registration is idempotent (the
   * route dedupes on the token), so a no-op costs one request.
   */
  const sincronizado = useRef(false)

  useEffect(() => {
    if (!hydrated || sincronizado.current) return
    if (!optIn) return

    const dados = ambiente.data
    if (!dados?.disponivel || !dados.concedida) return

    sincronizado.current = true

    void (async () => {
      try {
        const token = await obterTokenPush()
        if (token === tokenLocal) return
        await registrarDispositivo({ token, device: nomeDoDispositivo() })
        marcarAtivo(token)
      } catch {
        // Offline, or Expo is unreachable. Local state stays as it was and the
        // next mount tries again — nothing here is worth interrupting the user.
        sincronizado.current = false
      }
    })()
  }, [hydrated, optIn, ambiente.data, tokenLocal, marcarAtivo])

  const ativo = optIn && ambiente.data?.concedida === true

  return { ambiente, ativo, ativar, desativar, pronto: hydrated }
}

// Sign-out used to unregister push from here (useEncerrarSessao). It is now part
// of signOut() itself — see src/lib/auth.tsx. It had to move for two reasons:
// the "Mais" tab signs out without going through this screen and so skipped it
// entirely, and the token it deleted came from the local push store, which is
// only populated once the user has touched the switch below. For everyone who
// was auto-registered by the notifications runtime, it was deleting `null`.
