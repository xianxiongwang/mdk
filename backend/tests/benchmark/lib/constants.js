'use strict'

// Fixed defaults for the benchmark harness — as opposed to
// config/benchmark.config.json, which is the file meant to be edited to size
// a run (hardware, workers, ceiling). Values here don't vary per
// run and rarely need editing — the one exception is
// RUN_REPRODUCIBILITY.soakMs, bumped for a real (>= 24h) growth/leak claim.

const path = require('path')

// Every worker family under backend/workers/miners, keyed by the package
// name (without the @tetherto/ scope) — the only `type` values a
// config.workers[] entry may use. Each mock exposes its own supported
// models (`TYPES`) and auth default (`extraCliOptions.password.default`),
// read here instead of duplicated in the benchmark config.
const WORKER_PACKAGES = {
  'mdk-worker-whatsminer': 'startWhatsminerWorker',
  'mdk-worker-antminer': 'startAntminerWorker',
  'mdk-worker-avalon': 'startAvalonWorker'
}

const WORKER_REGISTRY = Object.fromEntries(
  Object.entries(WORKER_PACKAGES).map(([type, startExport]) => {
    const pkg = `@tetherto/${type}`
    const worker = require(pkg)
    const mock = require(`${pkg}/mock/server`)
    return [type, {
      startWorker: worker[startExport],
      mock,
      models: mock.types,
      defaultPassword: mock.defaultPassword
    }]
  })
)

// Alert thresholds forced far outside any real reading, so the family's own
// temperature-warning alert always trips on the first completed snap cycle.
// devicePrefix mirrors each worker package's own `deviceType` build
// (`miner-${devicePrefix}-${model}`, see plugin/boot.js in each package) —
// AlertsService keys its config by that exact device-type string. This is
// the one intentional exception to bootWorker's "workers boot on their own
// package defaults" rule (see lib/site.js): alerts need *some* threshold
// policy to fire at all, and there's no sensible default that isn't itself
// a deliberate choice, unlike the cadence/timeout knobs that rule protects.
const ALERT_INDUCTION = {
  'mdk-worker-whatsminer': {
    devicePrefix: 'wm',
    alerts: {
      pcb_temp_warning: { normalTemp: -1000, lowTemp: -1000, highTemp: -1000 }
    }
  },
  // max_pcb_temp_warning/critical compare snap.stats.temperature_c.raw_temps[].pcb
  // against the threshold, but that field is an array (board.temp_pcb) in
  // antminer.js's own translation, not a scalar — array >= number is always
  // false, so no threshold can ever trip those two. max_outlet_temp_warning
  // reads .temp[].pcbOutlet instead, which really is a scalar — correct in
  // principle, but currently unobservable end to end for an unrelated
  // reason: the Worker's own periodic snap collection (SnapsService →
  // deviceCall → runtime device-context lookup) reliably fails with
  // ERR_DEVICE_UNAVAILABLE for this family specifically (confirmed
  // reproducible over 3 consecutive 60s cycles), even though on-demand
  // pullTelemetry(id, 'metrics') for the same device works fine — so no
  // snap, and therefore no alert, is ever produced regardless of which
  // alert or threshold is configured here. Whatsminer/avalon don't show
  // this; it's specific to the antminer worker package's own device-context
  // binding, not this harness or the alerts machinery, and out of scope to
  // fix here. Expect rulesCount: 1 but devicesWithAlerts staying 0 for this
  // family until that's fixed upstream.
  'mdk-worker-antminer': {
    devicePrefix: 'am',
    alerts: {
      max_outlet_temp_warning: { params: { temp: -1000 } }
    }
  },
  // chips_temp_critical reads snap.stats.temperature_c.chips[].avg, sourced
  // from data.estats.avg_chip_temperature in avalon.miner.js — the avalon
  // mock never populates `estats` at all, so `chips` comes back `[]` and
  // this alert can never trip against the current mock regardless of
  // threshold. Left configured anyway (harmless, and correct if the mock
  // ever grows estats support) — expect rulesCount: 1 but devicesWithAlerts
  // staying 0 for this family until then.
  'mdk-worker-avalon': {
    devicePrefix: 'av',
    alerts: {
      chips_temp_critical: { params: { temp: -1000 } }
    }
  }
}

const DEFAULT_WORKER_TYPE = 'mdk-worker-whatsminer'
const DEFAULT_MODEL = 'm56s'

// This harness only ever runs mocks on loopback, differentiated by port —
// every device shares the same host, so duplicate-IP checks must stay off.
const ALLOW_DUPLICATE_IPS = true

const MOCK_PORT_RANGE = { min: 20000, max: 60000 }

// stats.service.js falls back to 500 internally when thing.thingRtdConcurrency
// is omitted; not part of WORKER_CONF_DEFAULTS, so mirrored here only for
// display/load-shape purposes — never passed to the worker itself.
const DEFAULT_THING_RTD_CONCURRENCY = 500

// Fixed harness topology — every profile boots on loopback, discovered
// locally (no DHT topic), namespaced under the same data root.
const HOST = '127.0.0.1'
const DISCOVERY = 'local'
const ROOT = '.mdk-data'

const KERNEL_DEFAULTS = {
  telemetryPullMs: 10000,
  healthPingMs: 5000,
  statePullMs: 20000,
  alertRulesCount: 0
}

const WORKER_CONF_DEFAULTS = {
  collectSnapsItvMs: 10000,
  rotateLogsItvMs: 60000,
  refreshLogsCacheItvMs: 30000,
  statsRtdItvMs: 5000,
  thingQueryConcurrency: 100,
  storeSnapItvMs: 20000,
  collectSnapTimeoutMs: 2000,
  logKeepCount: 3
}

// The one Gateway plugin every profile run loads — generic across any
// device family (fans out mdkClient.listWorkers()/pullTelemetry, see its
// controller), so it never needs to vary per config.workers entry.
const GATEWAY_PLUGIN_DIR = path.join(__dirname, '..', 'plugin', 'fleet-summary')

const GATEWAY_DEFAULTS = {
  requestPath: '/api/fleet/summary',
  deviceTelemetryPath: (deviceId) => `/api/fleet/device/${deviceId}/telemetry`,
  deviceActionPath: (deviceId) => `/api/fleet/device/${deviceId}/action`,
  deviceAlertsPath: (deviceId) => `/api/fleet/device/${deviceId}/alerts`
}

// Run-reproducibility knobs: sample counts, soak duration, resource-sampling
// cadence, and read/action load shape — recorded verbatim into every
// report's "Run reproducibility" section. Bump soakMs here for a real (>=
// 24h) growth/leak claim; everything else is sized for fast sweeps/CI.
const RUN_REPRODUCIBILITY = {
  n: 1000,
  nMinimumRecommended: 100,
  soakMs: 5000,
  soakMinimumMsForGrowthClaims: 86400000, // 24h
  resourceSampleIntervalMs: 250,
  readLoadConcurrency: 1000,
  readLoadDurationMs: 3000,
  actionLoadRatePerSec: 1000,
  actionLoadDurationMs: 3000,
  actionType: 'setPowerMode',
  actionParams: { mode: 'normal' },
  // Failure behaviour drills (see runFailureDrills in processes/run-process.js)
  // — real kill+restart/outage induction, run once after the steady-state
  // checklist finishes. Off by default in fast paths (the smoke test
  // overrides this false) since each drill adds real wall-clock time.
  runFailureDrills: true,
  workerRestartTimeoutMs: 5000,
  kernelRestartTimeoutMs: 5000,
  deviceOutageMs: 2000,
  recoveryPollIntervalMs: 250
}

// Pass/fail bars evaluateThresholds() (lib/report.js) judges a run against —
// headroom, action submit p99, steady CPU, rejects+timeouts, RSS slope.
const THRESHOLDS = {
  headroomGreenBelow: 0.7,
  headroomAmberBelow: 1.0,
  actionSubmitP99Ms: 2000,
  steadyCpuPctOfOneCore: 80,
  rejectPlusTimeoutMax: 0,
  rssSlopeFlatMiBPerHour: 2048
}

module.exports = {
  WORKER_REGISTRY,
  ALERT_INDUCTION,
  DEFAULT_WORKER_TYPE,
  DEFAULT_MODEL,
  ALLOW_DUPLICATE_IPS,
  MOCK_PORT_RANGE,
  DEFAULT_THING_RTD_CONCURRENCY,
  WORKER_CONF_DEFAULTS,
  HOST,
  DISCOVERY,
  ROOT,
  KERNEL_DEFAULTS,
  GATEWAY_PLUGIN_DIR,
  GATEWAY_DEFAULTS,
  RUN_REPRODUCIBILITY,
  THRESHOLDS
}
