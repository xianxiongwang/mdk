'use strict'

// Turns a profile run's raw measurements into the pass/fail + comparison
// artifacts described in docs/guides/deployment/capacity-metrics-template.md.
// renderMarkdown() mirrors that template's own section headings and table
// shapes exactly, cell for cell — real measurements where this harness has
// them, `_` (the template's own placeholder convention) everywhere it
// doesn't (heap/external memory, FDs, sockets, on-disk size, alert
// generation/Gateway/fan-out/history, action-approval, failure drills — see
// each section's comment below and README's "What's measured vs. left
// blank"; alert Kernel-visibility latency and induced-rule counts ARE
// measured, see renderLatency's Alerts path). Writes one JSON
// (machine-readable, feeds sweep comparison matrices) and one Markdown
// (this template-shaped render) file per profile under results/.

const path = require('path')
const fs = require('fs')
const { config } = require('./site')
const { dirSizeBytes } = require('./metrics')

function tier (value, greenBelow, amberBelow) {
  if (value == null) return '_'
  if (value < greenBelow) return 'green'
  if (value < amberBelow) return 'amber'
  return 'red'
}

function worstOf (tiers) {
  if (tiers.includes('red')) return 'red'
  if (tiers.includes('amber')) return 'amber'
  if (tiers.some((t) => t === '_')) return '_'
  return 'green'
}

function evaluateThresholds (profile, thresholds) {
  const headroomStatus = tier(profile.headroomRatio, thresholds.headroomGreenBelow, thresholds.headroomAmberBelow)

  const actionP99 = profile.latencies.actionSubmit.p99Ms
  const actionStatus = actionP99 == null ? '_' : (actionP99 <= thresholds.actionSubmitP99Ms ? 'green' : 'red')

  // Busiest single process, not the sum — see the "Steady-state CPU (host
  // or busiest process — state which)" threshold row.
  const cpu = Math.max(...Object.values(profile.resourceSummary).map((s) => s.avgCpuPct || 0))
  const cpuStatus = cpu == null ? '_' : (cpu <= thresholds.steadyCpuPctOfOneCore ? 'green' : 'red')

  const rejectsPlusTimeouts = profile.throughput.rejected + profile.throughput.timedOut +
    (profile.actionLoad ? profile.actionLoad.rejected + profile.actionLoad.timedOut : 0)
  const rejectsStatus = rejectsPlusTimeouts <= thresholds.rejectPlusTimeoutMax ? 'green' : 'red'

  // A soak shorter than the template's 24h minimum makes the MiB/h
  // extrapolation noise-dominated (a few KB of GC jitter over milliseconds
  // reads as gigabytes/hour) — cap its severity at amber so it's visible in
  // the report without failing the whole profile on statistical noise.
  const isIndicativeSoak = profile.runReproducibility.soakMs < profile.runReproducibility.soakMinimumMsForGrowthClaims
  const rssSlope = profile.rssSlopeMiBPerHour
  let rssStatus = rssSlope == null
    ? '_'
    : (Math.abs(rssSlope) <= thresholds.rssSlopeFlatMiBPerHour ? 'green' : 'red')
  if (isIndicativeSoak && rssStatus === 'red') rssStatus = 'amber'

  const overall = worstOf([headroomStatus, actionStatus, cpuStatus, rejectsStatus, rssStatus])

  return {
    telemetryFreshness: headroomStatus,
    actionSubmitP99: actionStatus,
    steadyCpu: cpuStatus,
    rejectsPlusTimeouts: rejectsStatus,
    rssSlope: rssStatus,
    rssSlopeIndicative: isIndicativeSoak,
    overall
  }
}

function fmt (n, digits = 1) {
  return n == null ? '_' : Number(n).toFixed(digits)
}

// --- Reference hardware ----------------------------------------------------

function renderHardware (hw) {
  return `## Reference hardware

### Hardware block (per profile)

| Field | Value |
| --- | --- |
| Reference tier | ${hw.referenceTier} |
| CPU model | ${hw.cpuModel} |
| CPU cores (physical / logical) | ${hw.cpuCoresPhysical} / ${hw.cpuCoresLogical} |
| RAM | ${hw.ramGiB} GiB |
| Disk type | ${hw.diskType} |
| Disk size | ${hw.diskSizeGiB} GiB |
| OS | ${hw.os} |
| Node.js version | ${hw.nodeVersion} |
| MDK version / commit | ${hw.mdkVersion} |
| Network path to devices | ${hw.networkPath} |
| Notes | ${hw.notes} |
`
}

// --- Capacity profile: Workers, Run reproducibility -------------------------

// The entry's configured ceiling, if this (type, model) still has one in the
// current config.workers — a sweep step's max may differ from a manual
// --devices override that doesn't correspond to any configured entry.
function configuredCeiling (type, model) {
  const spec = config.workers.find((w) => w.type === type && w.model === model)
  return spec ? spec.ceiling : null
}

function renderWorkersTable (workersBreakdown) {
  const rows = workersBreakdown.map((w) => {
    const ceiling = configuredCeiling(w.type, w.model)
    const max = ceiling && ceiling.maxDeviceCount ? ceiling.maxDeviceCount : '_'
    return `| ${w.type} (${w.model}) | ${w.deviceCount} | ${max} | simulated |`
  }).join('\n')
  return `## Capacity profile

### Workers

| Worker type | Device count | Max Device count | real / simulated |
| --- | --- | --- | --- |
${rows}
`
}

function renderRunReproducibility (profile) {
  const rr = profile.runReproducibility
  return `### Run reproducibility

| Field | Value |
| --- | --- |
| Profile id | ${profile.profileId} |
| \`n\` (samples per latency row) | ${rr.n} (minimum recommended: ${rr.nMinimumRecommended}) |
| Soak duration | ${rr.soakMs} ms ${rr.soakMs < rr.soakMinimumMsForGrowthClaims ? '(**indicative** — below the 24h minimum for growth/leak claims)' : ''} |
| Read load definition | ${rr.readLoadConcurrency} concurrent telemetry reads for ${rr.readLoadDurationMs} ms |
| Action load definition | ${rr.actionLoadRatePerSec}/s ${rr.actionType} submits for ${rr.actionLoadDurationMs} ms |
| Start time (UTC) | ${profile.timestamps.startUtc} |
| End time (UTC) | ${profile.timestamps.endUtc} |
`
}

// --- Resource metrics: per process, site aggregate, storage, zero-device ---

// RSS has real warm/steady/peak samples (ResourceSampler tracks first/last/
// peak already); CPU average only has an overall run average (shown under
// Steady, the most representative single number); heap/external/FDs/
// sockets/disk aren't visible cross-process via `ps` — that needs in-process
// instrumentation this harness doesn't have (see README).
function renderProcessTable (label, s) {
  return `#### ${label}

| Metric | Unit | Warm (after READY) | Steady (end of soak) | Peak | Notes |
| --- | --- | --- | --- | --- | --- |
| CPU average | % of 1 core | \`_\` | ${fmt(s.avgCpuPct)} | \`_\` | sampled cross-process via \`ps -o pcpu\` |
| CPU peak | % | \`_\` | \`_\` | ${fmt(s.peakCpuPct)} | |
| RSS | MiB | ${fmt(s.firstRssMiB)} | ${fmt(s.lastRssMiB)} | ${fmt(s.peakRssMiB)} | sampled cross-process via \`ps -o rss\` |
`
}

function renderSiteAggregate (profile) {
  const summaries = Object.values(profile.resourceSummary)
  const rssSum = summaries.reduce((sum, s) => sum + (s.avgRssMiB || 0), 0)
  const cpuSum = summaries.reduce((sum, s) => sum + (s.avgCpuPct || 0), 0)
  return `### Site aggregate

| Metric | Unit | Value |
| --- | --- | --- |
| Sum of process RSS | MiB | ${fmt(rssSum, 0)} |
| Host CPU (all MDK processes) | % | ${fmt(cpuSum)} |
`
}

// Only worker stores — Kernel/Gateway/alerts/logs storage isn't broken out
// per worker, so it doesn't belong in a "which worker costs how much disk"
// table. Row labels match the Workers table's own `type (model)` naming so
// the two tables cross-reference by the same name. Growth/day is a real
// delta — startSizeBytes was snapshotted right at profile start (see
// storeSizesAtStartBytes in processes/run-process.js), re-measured here
// (report-render time, i.e. "now") — divided by the run's own elapsed time,
// same short-soak caveat as the RSS slope (see Run reproducibility).
function renderStorageBreakdown (profile) {
  const rr = profile.runReproducibility
  const elapsedDays = (new Date(profile.timestamps.endUtc) - new Date(profile.timestamps.startUtc)) / 86400000
  const indicative = rr.soakMs < rr.soakMinimumMsForGrowthClaims

  const rows = profile.storePaths.workerStores.map((w) => {
    const nowBytes = dirSizeBytes(w.path)
    const sizeMiB = nowBytes / (1024 * 1024)
    const growthMiBPerDay = elapsedDays > 0 ? (nowBytes - w.startSizeBytes) / (1024 * 1024) / elapsedDays : null
    return { label: `${w.type} (${w.model})`, sizeMiB, growthMiBPerDay }
  })
  const totalMiB = rows.reduce((sum, r) => sum + r.sizeMiB, 0)
  const totalGrowthMiBPerDay = rows.every((r) => r.growthMiBPerDay != null)
    ? rows.reduce((sum, r) => sum + r.growthMiBPerDay, 0)
    : null

  const projected = (sizeMiB, growthMiBPerDay, months) =>
    growthMiBPerDay == null ? null : (sizeMiB + growthMiBPerDay * 30 * months) / 1024

  const fmtGrowth = (g) => `${fmt(g, 4)}${indicative ? ' (**indicative**)' : ''}`
  const workerRows = rows.map((r) =>
    `| ${r.label} | ${fmt(r.sizeMiB)} | ${fmtGrowth(r.growthMiBPerDay)} | ${fmt(projected(r.sizeMiB, r.growthMiBPerDay, 6), 4)} | ${fmt(projected(r.sizeMiB, r.growthMiBPerDay, 12), 4)} |`
  ).join('\n')

  return `### Storage breakdown

Growth/day is a real delta (size at profile start vs. now), divided by this run's own elapsed time (${fmt(elapsedDays * 24, 2)} h) — the same short-soak caveat as the RSS slope applies (see Run reproducibility): a soak below the 24h minimum makes this **indicative**, not a committed growth rate. Projections are linear extrapolations of that rate.

| Store | Size now (MiB) | Growth / day (MiB) | Projected 6 mo (GiB) | Projected 12 mo (GiB) |
| --- | --- | --- | --- | --- |
${workerRows}
| **Total** | ${fmt(totalMiB)} | ${fmtGrowth(totalGrowthMiBPerDay)} | ${fmt(projected(totalMiB, totalGrowthMiBPerDay, 6), 4)} | ${fmt(projected(totalMiB, totalGrowthMiBPerDay, 12), 4)} |
`
}

// mocks is excluded from both sides of the subtraction — it's a
// benchmark-simulation artifact (one TCP listener per worker, regardless of
// device count with the current mock topology), never part of a real MDK
// deployment, so it doesn't belong in a per-device marginal-cost figure.
function mdkOnlySummaries (resourceSummary) {
  return Object.entries(resourceSummary).filter(([key]) => key !== 'mocks').map(([, s]) => s)
}

function sumMetric (summaries, key) {
  return summaries.reduce((total, s) => total + (s[key] || 0), 0)
}

// Baseline comes from a same-shape Kernel + Gateway + one idle Worker per
// configured type/model (0 owned devices each), booted and sampled
// alongside the real run (see runZeroDeviceBaseline in processes/run-process.js)
// — a real subtraction, not a placeholder. Heap/external/FDs/sockets stay
// unmeasured (see README); disk growth needs repeated measurements over
// time, which a single snapshot baseline can't give either.
function renderZeroDeviceBaseline (profile) {
  const baseline = mdkOnlySummaries(profile.zeroDeviceBaseline.resourceSummary)
  const atD = mdkOnlySummaries(profile.resourceSummary)
  const d = profile.deviceCount

  const baselineCpu = sumMetric(baseline, 'avgCpuPct')
  const baselineRss = sumMetric(baseline, 'avgRssMiB')
  const atDCpu = sumMetric(atD, 'avgCpuPct')
  const atDRss = sumMetric(atD, 'avgRssMiB')
  const marginalCpu = d > 0 ? (atDCpu - baselineCpu) / d : null
  const marginalRss = d > 0 ? (atDRss - baselineRss) / d : null

  return `### Zero-device baseline and per-device marginal cost

Baseline: Kernel + Gateway + one idle Worker per configured type/model (0
owned devices each), booted and sampled the same way as the real run,
concurrently with it. \`mocks\` is excluded from both sides — see note below.

| Metric | Zero-device baseline | At ${d} devices | Per-device marginal | Unit |
| --- | --- | --- | --- | --- |
| CPU (site, all MDK processes) | ${fmt(baselineCpu)} | ${fmt(atDCpu)} | ${fmt(marginalCpu, 4)} | % of 1 core |
| RSS (site, all MDK processes) | ${fmt(baselineRss, 0)} | ${fmt(atDRss, 0)} | ${fmt(marginalRss, 4)} | MiB |
`
}

// worker-N keys are named after the Workers table's own `type (model)` —
// same name, so a reader can cross-reference the two tables directly.
function processLabel (key, workersBreakdown) {
  const m = /^worker-(\d+)$/.exec(key)
  if (!m) return key
  const w = workersBreakdown[Number(m[1])]
  return w ? `${w.type} (${w.model})` : key
}

function renderResourceMetrics (profile) {
  const processTables = Object.entries(profile.resourceSummary)
    .map(([key, s]) => renderProcessTable(processLabel(key, profile.workersBreakdown), s)).join('\n')
  return `## Resource metrics template

Sampled per OS process by pid (\`ps -o rss,pcpu\`) at ${profile.runReproducibility.resourceSampleIntervalMs} ms intervals — real per-process numbers, not one blended figure, but no heap/external breakdown (that needs in-process instrumentation this harness doesn't have).

### Per process

${processTables}
${renderSiteAggregate(profile)}
${renderStorageBreakdown(profile)}
${renderZeroDeviceBaseline(profile)}`
}

// --- Device baseline (MDK overhead) -----------------------------------------

function renderDeviceBaseline (profile) {
  const lat = profile.latencies
  const db = profile.deviceBaseline
  const readOverhead = fmt(lat.telemetrySingle.p99Ms - db.p99Ms)
  const execOverhead = fmt(lat.actionSubmit.p99Ms - db.p99Ms)
  return `## Device baseline (MDK overhead)

| Measurement | Boundary | p50 ms | p95 ms | p99 ms | max ms | n | Real / simulated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Device-only telemetry / status read | Raw TCP connect to mock (**approximate**: not the full vendor-protocol round trip) | ${fmt(db.p50Ms)} | \`_\` | ${fmt(db.p99Ms)} | ${fmt(db.maxMs)} | ${db.n} | simulated |

| Derived | Formula | Value |
| --- | --- | --- |
| MDK overhead (read p99) | telemetry read p99 − device-only p99 | ${readOverhead} ms |
| MDK overhead (action exec p99) | action submit p99 − device-only p99 (**approximate** — submit and exec aren't measured separately, see Write / action path) | ${execOverhead} ms |
`
}

// --- Cycle headroom ----------------------------------------------------------

function renderCycleHeadroom (profile, verdict) {
  const c = profile.cycleHeadroomWorst
  return `## Cycle headroom (devices per Worker signal)

| Metric | Value | Unit |
| --- | --- | --- |
| Configured telemetry interval | ${profile.operatingParameters.workerCollectSnapsItvMs} | ms |
| Full collection cycle time (worst Worker, all owned devices) | ${fmt(c.avgCycleMs)} | ms (avg / max: ${fmt(c.avgCycleMs)} / ${fmt(c.maxCycleMs)}) |
| Cycle headroom ratio | ${fmt(profile.headroomRatio, 3)} | cycle_time / interval |
| Devices owned by this Worker | ${c.deviceCount} | count |
| Unreachable devices during cycle | ${c.rejected + c.timedOut} | count |
| Timeout budget consumed by unreachable devices | \`_\` | ms |

| Headroom | Meaning |
| --- | --- |
| \`< 0.7\` | Comfortable |
| \`0.7–1.0\` | Amber — little spare capacity |
| \`>= 1.0\` | Overrun — reduce devices per Worker or raise concurrency / interval |

This profile: **${verdict.telemetryFreshness}**.
`
}

// --- Throughput under load ---------------------------------------------------

function renderThroughput (profile) {
  const t = profile.throughput
  const a = profile.actionLoad
  return `## Throughput under load

| Metric | Value | Unit |
| --- | --- | --- |
| Sustained telemetry reads / s | ${fmt(t.readsPerSec)} | 1/s |
| Sustained actions / s | ${fmt(a.actionsPerSec)} | 1/s |
| Queue depth (peak / steady) | ${t.peakQueueDepth} / \`_\` | count |
| Rejected requests | ${t.rejected + a.rejected} | count |
| Timed-out requests | ${t.timedOut + a.timedOut} | count |
`
}

// --- Latency metrics ----------------------------------------------------------

function latRow (label, boundary, l) {
  if (!l) return `| ${label} | ${boundary} | \`_\` | \`_\` | \`_\` | \`_\` | \`_\` | \`_\` |`
  return `| ${label} | ${boundary} | ${fmt(l.p50Ms)} | ${fmt(l.p95Ms)} | ${fmt(l.p99Ms)} | ${fmt(l.maxMs)} | ${l.n} | ${l.errors} |`
}

function renderLatency (profile) {
  const lat = profile.latencies
  const rr = profile.runReproducibility
  return `## Latency metrics template

All latencies in **milliseconds**, same percentile set across profiles.

### Read path (telemetry and state)

| Operation | Boundary | p50 ms | p95 ms | p99 ms | max ms | n | errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
${latRow('Telemetry read (single device)', 'Gateway → Kernel → Worker → Gateway', lat.gatewayTelemetrySingle)}
${latRow('Telemetry read (single device)', 'Client → Kernel → Worker (bypasses Gateway)', lat.telemetrySingle)}
${latRow('Telemetry / overview read (aggregate)', 'Gateway (+ fleet-summary plugin) → Kernel → Workers', lat.gatewayRequest)}
${latRow('Device list / registry read', 'Client → Kernel (bypasses Gateway)', lat.status)}

### Write / action path

| Operation | Boundary | p50 ms | p95 ms | p99 ms | max ms | n | errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
${latRow('Send / submit action', 'Client → Gateway → Kernel accept', lat.gatewayActionSubmit)}
${latRow('Action execution (Kernel dispatch → Worker → device ack)', 'Client → Kernel → Worker → device ack', lat.actionSubmit)}
${latRow('End-to-end write action (submit → executed / terminal state)', 'Client → … → device → client-visible result', lat.actionSubmit)}

| Action type | reqVotes | e2e p50 ms | e2e p99 ms | exec-only p50 ms | exec-only p99 ms | n |
| --- | --- | --- | --- | --- | --- | --- |
| ${rr.actionType} | \`_\` (whitelisted per-worker in each package's own boot.js — not read back here) | ${fmt(lat.actionSubmit.p50Ms)} | ${fmt(lat.actionSubmit.p99Ms)} | ${fmt(lat.actionSubmit.p50Ms)} | ${fmt(lat.actionSubmit.p99Ms)} | ${lat.actionSubmit.n} |

### Alerts path

Real condition, not injected: every device's temperature-warning threshold is forced below any real reading, so the devices's own alert trips on the first snap the Worker collects. Both rows below are n samples of one-per-device "time since this checklist started watching until the alert first appeared" — bounded below by the poll interval, and by the Worker's own snap interval above (\`${profile.operatingParameters.workerCollectSnapsItvMs}\` ms): n = 0
| Operation | Boundary | p50 ms | p95 ms | p99 ms | max ms | n | errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
${latRow('Alert visible via Kernel (pull / list / query)', 'Consumer → Kernel → alert source', lat.alertVisibleViaKernel)}
${latRow('Alert visible via Gateway (HTTP / WebSocket / plugin)', 'Consumer → Gateway → Kernel / store', lat.alertVisibleViaGateway)}

${Object.keys(profile.alerts.byName).length ? `Active alert names this run: ${Object.entries(profile.alerts.byName).map(([name, n]) => `${name} (${n})`).join(', ')}.` : ''}
`
}

// --- Pass / fail thresholds ---------------------------------------------------

function renderThresholds (profile, verdict) {
  const t = profile.thresholds
  const lat = profile.latencies
  const cpu = Math.max(...Object.values(profile.resourceSummary).map((s) => s.avgCpuPct || 0))
  const rejectsPlusTimeouts = profile.throughput.rejected + profile.throughput.timedOut + profile.actionLoad.rejected + profile.actionLoad.timedOut
  return `## Pass / fail thresholds

| Criterion | Green | Amber | Red | Profile result |
| --- | --- | --- | --- | --- |
| Telemetry freshness (cycle ≤ interval) | headroom < ${t.headroomGreenBelow} | ${t.headroomGreenBelow}–${t.headroomAmberBelow} | ≥ ${t.headroomAmberBelow} | ${fmt(profile.headroomRatio, 3)} (**${verdict.telemetryFreshness}**) |
| Action e2e p99 | ≤ ${t.actionSubmitP99Ms} ms | n/a — binary criterion, no amber band | above green | ${fmt(lat.actionSubmit.p99Ms)} ms (**${verdict.actionSubmitP99}**) |
| Steady-state CPU (busiest process) | ≤ ${t.steadyCpuPctOfOneCore}% | n/a — binary criterion, no amber band | above green | ${fmt(cpu)}% (**${verdict.steadyCpu}**) |
| Rejected + timed-out under sustained load | 0 | n/a — binary criterion, no amber band | above green | ${rejectsPlusTimeouts} (**${verdict.rejectsPlusTimeouts}**) |
| RSS slope over 24 h soak | flat (≤ ${t.rssSlopeFlatMiBPerHour} MiB/h) | red demoted to amber when soak < 24h (indicative) | clear leak (soak ≥ 24h) | ${fmt(profile.rssSlopeMiBPerHour, 3)} MiB/h (**${verdict.rssSlope}**) |

**Overall: ${verdict.overall.toUpperCase()}**
`
}

// --- Failure behaviour ---------------------------------------------------------

// Per-process breakdown for the two "per process" rows below — pulls
// straight from ResourceSampler.summary() (see lib/metrics.js), already
// computed as a real 2-point (RSS: every tick; FD: start/stop only) slope
// across this run's own sampling window. Same short-soak caveat as every
// other slope in this harness: real numbers, but "indicative" until backed
// by a real >= 24h soak.
function perProcessSlopes (resourceSummary, key, unit) {
  return Object.entries(resourceSummary)
    .map(([label, s]) => `${label}: ${s[key] == null ? '_' : `${fmt(s[key], 4)} ${unit}`}`)
    .join(', ')
}

// Worker/Kernel restart and the device-outage drill are real kill+restart/
// outage induction (see runFailureDrills in processes/run-process.js), run
// once after the steady-state checklist finishes — never during, so a
// killed process can't contaminate the capacity numbers above. Skipped
// entirely (not measured) only when RUN_REPRODUCIBILITY.runFailureDrills
// is off (the smoke test does this to stay fast).
function renderFailureBehaviour (profile) {
  const fb = profile.failureBehaviour
  if (!fb) {
    return `## Failure behaviour

Skipped for this run (RUN_REPRODUCIBILITY.runFailureDrills was off) — not the same as "not implemented"; see README for a run with drills on.

| Scenario | Metric | Value | Notes |
| --- | --- | --- | --- |
| Worker restart | Time to healthy / owning devices again | \`_\` ms | |
| Kernel restart | Time to READY | \`_\` ms | |
| Unreachable device | Effect on cycle time | \`_\` | timeout × count |
| Unreachable device | Timeout budget per device | \`_\` ms | from operating parameters |
| 24 h soak | RSS slope (MiB / h) per process | \`_\` | leak detection |
| 24 h soak | FD / socket slope | \`_\` | |
`
  }

  const ud = fb.unreachableDevice
  const measuredEffectMs = ud.measured.duringFailed ? ud.measured.duringMs : null
  return `## Failure behaviour

Worker restart and Kernel restart are real kill+respawn drills against the same on-disk store/root (both processes' identity persists across a restart). The unreachable-device drill kills the mocks process: every device behind a worker shares one mock server, so this can only make the **whole fleet** unreachable at once. A killed mocks process refuses the connection immediately (ECONNREFUSED), so the *measured* effect is immediate.

| Scenario | Metric | Value | Notes |
| --- | --- | --- | --- |
| Worker restart | Time to healthy / owning devices again | ${fmt(fb.workerRestart.ms, 0)} ms | ${fb.workerRestart.workerId}, ${fb.workerRestart.deviceCount} devices, recovered=${fb.workerRestart.recovered} |
| Kernel restart | Time to READY | ${fmt(fb.kernelRestart.ms, 0)} ms | recovered=${fb.kernelRestart.recovered} |
| Unreachable device | Effect on cycle time (measured, fast-refusal) | ${measuredEffectMs == null ? '`_` (request still succeeded during the outage)' : `${fmt(measuredEffectMs, 1)} ms`} | baseline ${fmt(ud.measured.baselineMs, 1)} ms → during ${fmt(ud.measured.duringMs, 1)} ms → recovered ${fmt(ud.measured.recoveredMs, 1)} ms |
| Unreachable device | Effect on cycle time (analytical, hung-device worst case) | ${fmt(ud.analyticalEffectMs, 0)} ms | timeout (${ud.timeoutBudgetMs} ms) × ⌈${ud.unreachableCount} devices / ${ud.concurrency} concurrency⌉ |
| Unreachable device | Timeout budget per device | ${fmt(ud.timeoutBudgetMs, 0)} ms | from operating parameters (\`collectSnapTimeoutMs\`) |
| 24 h soak | RSS slope (MiB / h) per process | ${perProcessSlopes(profile.resourceSummary, 'rssSlopeMiBPerHour', 'MiB/h')} | leak detection — **indicative**, soak below 24h |
| 24 h soak | FD / socket slope (per hour) per process | ${perProcessSlopes(profile.resourceSummary, 'fdSlopePerHour', '/h')} | sampled via \`lsof -p <pid>\` at start/stop only (more expensive than \`ps\`) — **indicative**, soak below 24h |
`
}

function renderMarkdown (profile, verdict) {
  const profileWithVerdict = { ...profile, verdict }
  return `# Capacity profile: ${profile.profileId}

Sweep: ${profile.sweep || '_'} · Mode: ${profile.mode} · Generated: ${profile.timestamps.endUtc}

${renderHardware(profile.hardware)}
${renderWorkersTable(profile.workersBreakdown)}
${renderRunReproducibility(profile)}
${renderResourceMetrics(profileWithVerdict)}
${renderDeviceBaseline(profile)}
${renderCycleHeadroom(profile, verdict)}
${renderThroughput(profile)}
${renderLatency(profile)}
${renderThresholds(profile, verdict)}
${renderFailureBehaviour(profile)}`
}

function writeReport (profile, { resultsDir }) {
  fs.mkdirSync(resultsDir, { recursive: true })
  const verdict = evaluateThresholds(profile, profile.thresholds)
  const jsonPath = path.join(resultsDir, `${profile.profileId}.json`)
  const mdPath = path.join(resultsDir, `${profile.profileId}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify({ ...profile, verdict }, null, 2))
  fs.writeFileSync(mdPath, renderMarkdown(profile, verdict))
  return { jsonPath, mdPath, verdict }
}

function matrixRow (profile, verdict) {
  const cpu = Object.values(profile.resourceSummary).reduce((sum, s) => sum + (s.avgCpuPct || 0), 0)
  const rss = Object.values(profile.resourceSummary).reduce((sum, s) => sum + (s.avgRssMiB || 0), 0)
  return [
    profile.profileId, profile.hardware.referenceTier, 'simulated',
    1, 1, 1, profile.workerCount, profile.deviceCount, profile.alerts.rulesCount,
    fmt(cpu), fmt(rss, 0), '_', '_', '_',
    fmt(profile.headroomRatio, 3),
    fmt(profile.throughput.readsPerSec), fmt(profile.actionLoad.actionsPerSec),
    profile.throughput.rejected + profile.throughput.timedOut + profile.actionLoad.rejected + profile.actionLoad.timedOut,
    fmt(profile.latencies.telemetrySingle.p99Ms), fmt(profile.latencies.actionSubmit.p99Ms), '_',
    verdict.overall
  ]
}

function buildComparisonMatrixMarkdown (entries) {
  const header = '| Profile id | Tier | Real/sim | Kernels | Gateways | Plugins | W | D | Alert rules | CPU sum % | RSS sum | Heap sum | Disk now | Disk/day | Headroom | Reads/s | Actions/s | Rejects+timeouts | Read p99 | Action e2e p99 | Alert gen p99 | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  const rows = entries.map(({ profile, verdict }) => `| ${matrixRow(profile, verdict).join(' | ')} |`)
  return [header, ...rows].join('\n') + '\n'
}

function writeComparisonMatrix (entries, { resultsDir, sweepId }) {
  fs.mkdirSync(resultsDir, { recursive: true })
  const mdPath = path.join(resultsDir, `sweep-${sweepId}-matrix.md`)
  fs.writeFileSync(mdPath, `# Sweep ${sweepId} — profile comparison matrix\n\n${buildComparisonMatrixMarkdown(entries)}`)
  return mdPath
}

module.exports = { evaluateThresholds, writeReport, buildComparisonMatrixMarkdown, writeComparisonMatrix }
