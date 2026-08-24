import type { VoteActionPayload } from '@tetherto/mdk-ui-foundation'
import { voteActionMutation } from '@tetherto/mdk-ui-foundation/presets/mining'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ACTIONS_WRITE_PERM, invalidateAfterActionWrite } from './action-write-utils'
import { useCheckPerm } from './use-permissions'

export type UseVoteOnActionResult = {
  /** Approve or reject a pending action by id. */
  vote: (payload: VoteActionPayload) => Promise<unknown>
  /** Whether the current token may vote (`actions:w`). */
  canVote: boolean
  isVoting: boolean
  error: unknown
}

/**
 * Casts an approve/reject vote on a pending action via
 * `PUT /auth/actions/voting/:id/vote`. Invalidates the pool/miner/actions
 * caches on success so the review tray and dashboard reflect the new state.
 * Gated by `actions:w`.
 *
 * @remarks
 * The `/auth/actions/*` endpoint is illustrative. MDK does not ship a built-in
 * endpoint for it — create your own via a
 * [Gateway plugin](https://docs.tether.io/mdk/guides/gateway/plugins) matching
 * your Worker/business logic. No reference implementation of `/auth/actions/*`
 * ships in this repo.
 *
 * @category dashboard
 */
export const useVoteOnAction = (): UseVoteOnActionResult => {
  const queryClient = useQueryClient()
  const canVote = useCheckPerm({ perm: ACTIONS_WRITE_PERM })
  const factory = voteActionMutation(queryClient)

  const mutation = useMutation({
    mutationKey: factory.mutationKey,
    mutationFn: (payload: VoteActionPayload) => factory.mutationFn(payload),
    onSuccess: () => invalidateAfterActionWrite(queryClient),
  })

  return {
    vote: (payload) => mutation.mutateAsync(payload),
    canVote,
    isVoting: mutation.isPending,
    error: mutation.error,
  }
}
