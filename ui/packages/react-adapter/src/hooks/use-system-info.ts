import { featureConfigQuery, siteQuery, userInfoQuery, type UserInfoResponse } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuthToken } from './use-auth-token'

/** Page-ready system snapshot shaped from three read-only Gateway endpoints. */
export type SystemInfo = {
  /** Configured site label from `GET /auth/site`. */
  site: string | undefined
  /** Signed-in user's email from `GET /auth/userinfo`. */
  email: string | undefined
  /** Signed-in user's roles from `GET /auth/userinfo` metadata. */
  roles: string | undefined
  /** Count of deployment feature flags from `GET /auth/featureConfig`. */
  featureCount: number
}

export type UseSystemInfoResult = {
  /** Shaped, render-ready values — never raw backend envelopes. */
  info: SystemInfo
  isLoading: boolean
  error: unknown
  /** Refetch all three reads. */
  refetch: () => void
}

/** Prefer the richer `metadata.email` over the top-level field when present. */
const pickEmail = (data: UserInfoResponse | undefined): string | undefined => {
  const metaEmail = typeof data?.metadata?.email === 'string' ? data.metadata.email : undefined
  const topEmail = typeof data?.email === 'string' ? data.email : undefined
  return metaEmail ?? topEmail
}

const pickRoles = (data: UserInfoResponse | undefined): string | undefined =>
  typeof data?.metadata?.roles === 'string' ? data.metadata.roles : undefined

/**
 * Reference example hook. Composes three read-only Gateway endpoints into a
 * single page-ready payload for the shell's System Info page:
 *   • `GET /auth/site`          → configured site label
 *   • `GET /auth/userinfo`      → signed-in user's email + roles
 *   • `GET /auth/featureConfig` → deployment feature-flag count
 *
 * Demonstrates the canonical MDK data-fetch pattern end to end: bind
 * `@tetherto/mdk-ui-foundation` query factories with TanStack Query and return
 * a shaped result, so the consuming page stays thin glue and never touches
 * `fetch` or a store directly. The MDK is single-site only — this surfaces just
 * a flag COUNT, never the raw multi-site keys the backend may include.
 *
 * @remarks
 * **Prerequisite:** `/auth/site` and `/auth/featureConfig` are served by the
 * default `site-monitor` Gateway plugin, but `/auth/userinfo` has no default
 * provider. The bundled `@tetherto/mdk-plugin-auth` ships a `/auth/userinfo`
 * controller, but mounting it via `extraPluginDirs` is not enough on its
 * own — see
 * [the bundled auth plugin](https://github.com/tetherto/mdk/blob/main/backend/core/plugins/README.md#the-bundled-auth-plugin)
 * for why. Without a working identity layer serving `/auth/userinfo`,
 * `email` and `roles` stay `undefined`.
 *
 * @category example
 */
export const useSystemInfo = (): UseSystemInfoResult => {
  const queryClient = useQueryClient()
  const token = useAuthToken()
  const enabled = !!token

  const site = useQuery({
    ...siteQuery(queryClient),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const user = useQuery({
    ...userInfoQuery(queryClient),
    enabled,
    staleTime: 5 * 60 * 1_000,
  })
  const features = useQuery({
    ...featureConfigQuery(queryClient),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const info: SystemInfo = {
    site: site.data?.site,
    email: pickEmail(user.data),
    roles: pickRoles(user.data),
    featureCount: features.data ? Object.keys(features.data).length : 0,
  }

  return {
    info,
    isLoading: site.isLoading || user.isLoading || features.isLoading,
    error: site.error ?? user.error ?? features.error,
    refetch: () => {
      void site.refetch()
      void user.refetch()
      void features.refetch()
    },
  }
}
