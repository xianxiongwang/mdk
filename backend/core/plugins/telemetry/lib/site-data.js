'use strict'

// The telemetry data source: worker-owned history over the mdk client, on
// the call surface the controllers always used (requestData & co, results
// as an array of per-source entry lists). Each source is a worker answering
// telemetry.pull worker-infra queries — the kernel stores no telemetry
// (workers own it, kernel/lib/storage/stores.js), so history comes from the
// workers' own stat and log bees. A worker without the queried bee or
// service answers an error payload and is skipped; an unreachable kernel
// degrades to empty results so the routes keep answering their zero shapes.

const mdkClient = require('./client')
const { RPC_METHODS, LOG_KEYS } = require('../../lib/constants')

async function _fanout (query) {
  let workers
  try {
    workers = (await mdkClient.getStatus()).workers
  } catch {
    return []
  }
  const settled = await Promise.allSettled(
    workers.map((w) => mdkClient.pullWorkerTelemetry(w.workerId, query))
  )
  return settled
    .filter((s) => s.status === 'fulfilled' && s.value && !s.value.error)
    .map((s) => s.value)
}

// The store's second-level aggregation named its outputs `<field>_aggr`;
// with one aggregation level (the worker's own stat rows) the values are the
// same numbers under the base name. Alias every field so controllers keep
// reading the vocabulary they always did.
function _aliasAggr (row) {
  const out = { ...row }
  for (const [k, v] of Object.entries(row)) {
    if (k === 'ts') continue
    const alias = `${k}_aggr`
    if (!(alias in out)) out[alias] = v
  }
  return out
}

// The workers' tailLog speaks the legacy vocabulary directly (key, tag,
// start, end, limit, groupRange, shouldCalculateAvg). The legacy `type` was
// the store's worker-type namespace — workers self-select by owning the
// `<key>-<tag>` bee — and fields/aggrFields projections are dropped so every
// row keeps its ts; controllers already read only the fields they chart.
async function _tailLog ({ type, fields, aggrFields, ...params }) {
  const payloads = await _fanout({ type: 'logs', ...params })
  const rows = payloads.flatMap((p) => (Array.isArray(p.logs) ? p.logs : []))
  return [rows.map(_aliasAggr)]
}

// Range aggregates come straight from the daily stat bees; rows map onto the
// { data: [{ ts, val }] } entries forEachRangeAggrItem consumes, and the
// controllers sum across workers per day bucket.
async function _tailLogRangeAggr ({ keys }) {
  const entries = []
  for (const k of keys || []) {
    const payloads = await _fanout({
      type: 'logs',
      key: LOG_KEYS.STAT_1D,
      tag: `t-${k.type}`,
      start: k.startDate ? Date.parse(k.startDate) : undefined,
      end: k.endDate ? Date.parse(k.endDate) : undefined
    })
    for (const p of payloads) {
      const rows = Array.isArray(p.logs) ? p.logs : []
      entries.push({ data: rows.map((r) => ({ ts: r.ts, val: _aliasAggr(r) })) })
    }
  }
  return [{ data: entries }]
}

async function _listThings (params) {
  const payloads = await _fanout({ type: 'list', limit: 1000 })
  const wanted = (params && params.query && params.query.tags && params.query.tags.$in) || null
  const things = payloads.flatMap((p) => (Array.isArray(p.things) ? p.things : []))
  const filtered = wanted
    ? things.filter((t) => (t.tags || []).some((tag) => wanted.includes(tag)))
    : things
  return [filtered]
}

async function _wrkExtData (params) {
  const payloads = await _fanout({ type: 'ext_data', ...params })
  return payloads.map((p) => p.extData)
}

async function requestData (method, params) {
  if (method === RPC_METHODS.TAIL_LOG) return _tailLog(params || {})
  if (method === RPC_METHODS.TAIL_LOG_RANGE_AGGR) return _tailLogRangeAggr(params || {})
  if (method === RPC_METHODS.GET_WRK_EXT_DATA) return _wrkExtData(params || {})
  throw new Error(`ERR_SITE_DATA_UNSUPPORTED: ${method}`)
}

async function requestDataAllPages (method, params) {
  if (method === RPC_METHODS.LIST_THINGS) return _listThings(params || {})
  throw new Error(`ERR_SITE_DATA_UNSUPPORTED: ${method}`)
}

module.exports = {
  requestData,
  requestDataMap: requestData,
  requestDataAllPages
}
