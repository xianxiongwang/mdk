/**
 * Your permission policy — MDK deliberately does not ship one.
 *
 * `useCheckPerm` / `useHasPerms` read `authStore.permissions`, and the write
 * affordances (`canVote`, `canSubmit`, `canCancel`, comment editing, feature
 * editing) are gated on it. Nothing populates it unless you do, so every one of
 * those affordances stays disabled out of the box.
 *
 * MDK has no opinion here on purpose: no Gateway token or endpoint carries a
 * permission document, so the only thing available to derive one from is the
 * token's `roles:` list — and how your roles map to permissions is a decision
 * about your deployment, not something a toolkit can guess. So the mapping lives
 * here, in your app, where you can change it without forking anything.
 *
 * **This is a worked example, not a recommendation.** Replace the body with your
 * real policy — ideally reading a permission document your backend serves, at
 * which point this file becomes a fetch instead of a mapping.
 *
 * Note the gates only *report*: the mutations run regardless, and the Gateway is
 * the real enforcer. Getting this mapping wrong shows a button that then fails
 * server-side — worth fixing, but it is not a security boundary.
 */

import type { AuthConfig } from '@tetherto/mdk-ui-foundation'
import {
  AUTH_LEVELS,
  AUTH_PERMISSIONS,
  getRolesFromAuthToken,
  USER_ROLE,
} from '@tetherto/mdk-ui-foundation'

/** The Gateway's "all roles" wildcard, as it appears in the token. */
const WILDCARD_ROLE = '*'

const READ = AUTH_LEVELS.READ
const READ_WRITE = `${AUTH_LEVELS.READ}${AUTH_LEVELS.WRITE}`

/** Access types this shell gates on. Extend as you add gated surfaces. */
const GATED_ACCESS = [AUTH_PERMISSIONS.ACTIONS, AUTH_PERMISSIONS.COMMENTS] as const

/**
 * Derive an {@link AuthConfig} from the roles encoded in a session token.
 *
 * Deliberately coarse — it grants write to everyone except the read-only role,
 * which is enough to make the shell's affordances behave sensibly while you
 * decide the real policy. `caps` gets the raw role list so `useCheckPerm({ cap })`
 * can test for a role directly.
 */
export const permissionsFromToken = (token: string): AuthConfig => {
  const roles = getRolesFromAuthToken(token)

  const isSuperAdmin = roles.includes(WILDCARD_ROLE) || roles.includes(USER_ROLE.ADMIN)
  const isReadOnly = roles.includes(USER_ROLE.READ_ONLY)
  const level = isReadOnly ? READ : READ_WRITE

  return {
    superAdmin: isSuperAdmin,
    write: !isReadOnly,
    caps: roles,
    permissions: GATED_ACCESS.map((access) => `${access}:${level}`),
  }
}
