/**
 * Re-export of the MongoDB-style query builders that now live in
 * `@tetherto/mdk-ui-foundation` (per the separation-of-concerns rule —
 * query-shape generators belong in ui-foundation, not the React layer).
 *
 * Kept here so existing imports under `foundation/utils/query-utils`
 * continue to resolve. New code should import directly from
 * `@tetherto/mdk-ui-foundation/presets/mining` — these builders emit the
 * mining Gateway's Mongo selector vocabulary, so they are preset-scoped and
 * not part of the backend-agnostic root barrel.
 */

export {
  CONTAINER_LIST_THINGS_LIMIT,
  getByIdsQuery,
  getByTagsQuery,
  getByTagsWithAlertsQuery,
  getByTagsWithCriticalAlertsQuery,
  getByThingsAttributeQuery,
  getByTypesQuery,
  getContainerByContainerTagsQuery,
  getContainerMinersByContainerTagsQuery,
  getDeviceByAlertId,
  getFiltersQuery,
  getListQuery,
  getLvCabinetDevicesByRoot,
  getMinersByContainerTagsQuery,
  getSitePowerMeterQuery,
} from '@tetherto/mdk-ui-foundation/presets/mining'
