# MDK capacity/metrics benchmark harness

Fills in [`docs/guides/deployment/capacity-metrics-template.md`](../../../docs/guides/deployment/capacity-metrics-template.md)
from measured runs instead of by hand. It boots real Kernel + Gateway +
Worker + mock-device processes (one mock TCP/HTTP listener per **Worker** —
every device that Worker owns shares it, real network round trips, not
in-memory fakes; any worker family under [`backend/workers/miners/`](../../workers/miners/README.md) can be
mixed into a single run), drives read/action/Gateway-request load against
them, samples CPU/RSS/open-FDs per process, runs real failure drills
(Worker restart, Kernel restart, a fleet-wide unreachable-device outage),
and writes a filled profile (JSON + Markdown) per run plus a comparison
matrix across a sweep. The generated Markdown mirrors the template's own
section headings and table shapes exactly — real measurements where this
harness has them, `_` (the template's own placeholder) everywhere it
doesn't; see "What's measured vs. left blank" below for which is which.

Every run uses the same process topology a real MDK deployment runs under
PM2 — mocks, Kernel, Gateway, and each Worker as their own OS process, never
blended into one Node process, and every entry in `config.workers` runs
simultaneously in the same profile (never one family at a time). A single
JSON config is the source of truth for the fleet to boot
([`config/benchmark.config.json`](./config/benchmark.config.json.example) — copy the `.example` to this path locally); [`lib/constants.js`](./lib/constants.js) holds everything
that isn't meant to vary per run (the worker-type registry, allowed defaults,
alert induction thresholds, failure-drill toggles/timeouts);
[`lib/site.js`](./lib/site.js) holds the boot primitives (bootKernel/bootWorker/bootGateway/startMocks);
[`processes/run-process.js`](./processes/run-process.js) is a per-role CLI entrypoint (`--role
mocks|kernel|worker|gateway|profile`) — `profile` computes the device plan
once, spawns the other four roles as child processes, waits for each to
report ready, drives load and samples every child's CPU/RSS/FDs by pid, then
(unless disabled) runs the failure drills once the steady-state checklist
is done.

## Quick start

```bash
# fast correctness check (5 devices, ~seconds) — wired into `npm test`
npm test

# the one benchmark run: boots every family in config.workers
# simultaneously and sweeps the Cartesian product of every family's own
# device-count range, lowest total device count first, stopping at the
# first combination that goes red (the fleet's breaking point — see
# capacity-metrics-template.md "Ceiling profiles")
npm run benchmark
```

Every combination step writes `results/<profileId>.json` and `.md`, named
by that step's total device count and worker count (e.g.
`cap-150devices-2workers` for 100 Whatsminers + 50 Antminers on 2 Workers)
— two different per-family splits that land on the same total/worker count
do collide, the later one's report overwriting the earlier one's; the run
as a whole additionally writes one combined `results/sweep-benchmark-matrix.md`
(generated under gitignored `results/` — not committed) across every combination
tried. Commit the specific reports you want to keep alongside a sizing decision,
not the whole directory.

## The config file

[`config/benchmark.config.json`](./config/benchmark.config.json.example) (copy from the linked `.example`) is the only file you edit to change what gets
measured:

| Section | Feeds |
| --- | --- |
| `hardware` | The template's "Reference hardware" block — fill this in manually per host; the harness can't detect vendor/tier |
| `workers` | One entry per device family, all booted simultaneously and swept together: `[{ type, model, simulateMocks, ceiling: { startDeviceCount, stepDeviceCount, maxDeviceCount } }]` — `type` must be one of `Object.keys(WORKER_REGISTRY)` in [`lib/constants.js`](./lib/constants.js) (one entry per package under [`backend/workers/miners/`](../../workers/miners/README.md)), `model` one of that type's supported models. `ceiling.startDeviceCount`/`stepDeviceCount` must each be `>= 1`; `maxDeviceCount` caps how far that entry's dimension of the sweep goes, and both other fields must additionally fall within `[1, maxDeviceCount]` — unless there's only one entry in `workers`, in which case `maxDeviceCount` may be `0` (uncapped: keep raising the device count until a step actually goes red). With more than one entry every `maxDeviceCount` must be a real number, since the sweep is the Cartesian product of every entry's range and an unbounded dimension can't be combined into a finite product. Validated eagerly when the config loads |

Everything that isn't about sizing a run — host/discovery/data root, Kernel
cadence, worker operating intervals/timeouts/concurrency,
`allowDuplicateIPs`, mock port/auth password, alert-induction thresholds,
failure-drill toggles, run-reproducibility shape (`n`, soak duration,
resource-sample interval, read/action load), and pass/fail thresholds
(headroom, action submit p99, steady CPU, rejects+timeouts, RSS slope) —
lives in [`lib/constants.js`](./lib/constants.js) instead: workers always boot on their own
package defaults (plus `ALERT_INDUCTION`'s threshold override, the one
intentional exception — see [`lib/site.js`](./lib/site.js)), `allowDuplicateIPs` is always
on (every mock lives on `127.0.0.1`, one server per Worker — its devices
share it — differentiated only by port), mock ports are picked randomly per
run (one per Worker, not per device), each worker's password is read from
its worker type's own mock default, and `RUN_REPRODUCIBILITY`/`THRESHOLDS`
are recorded verbatim into every report.

`RUN_REPRODUCIBILITY.soakMs` defaults short (5s) so sweeps and CI stay fast.
The template requires **≥ 24h** before treating an RSS slope as a real
growth/leak signal — bump `soakMs` in [`lib/constants.js`](./lib/constants.js) for that and run
a single profile, not a full sweep. Reports label any shorter soak's RSS
slope **indicative**.

## What's measured vs. left blank

Measured automatically:

- **Read path**: single-device telemetry both through the Gateway
  (`GET /api/fleet/device/{id}/telemetry`, a plugin route this harness
  adds) and bypassing it (Client → Kernel → Worker directly); the aggregate
  fleet-wide read (Gateway → Kernel → every Worker, through the harness's
  own generic [`plugin/fleet-summary`](./plugin/fleet-summary/) plugin); device list/registry read.
- **Write/action path**: submit through the Gateway
  (`POST /api/fleet/device/{id}/action`, another plugin route this harness
  adds) and the direct Client → Kernel path — both real HTTP/RPC round
  trips, not simulated. Submit and execute collapse into one measured step
  because every shipped worker whitelists its write actions at a single
  required vote (see "Left blank" below).
- **Cycle headroom** (worst Worker) and **sustained read/action throughput**
  (reads/s, actions/s, rejected, timed-out, peak queue depth).
- **Per-process CPU/RSS** (sampled every tick via `ps -o rss,pcpu -p <pid>`)
  and **open file descriptors** (sampled at profile start and end via
  `lsof -p <pid>` — more expensive than `ps`, so not sampled every tick),
  each with a real slope across the run (`ResourceSampler` in
  [`lib/metrics.js`](./lib/metrics.js)) — **indicative** below a 24h soak, same as everywhere
  else growth/leak claims show up in this harness.
- An **approximate** device-only baseline (raw TCP connect to the mock's
  port — a floor, not the full vendor-protocol round trip).
- **Alerts path**: every device's temperature-warning threshold is forced
  below any real reading (see `ALERT_INDUCTION` in [`lib/constants.js`](./lib/constants.js)), so
  the family's own alert genuinely trips on the first snap the Worker
  collects at its own (never-overridden) cadence. The harness measures how
  long after it starts watching that alert first becomes visible both via
  the Kernel directly (`pollAlerts` in [`lib/load.js`](./lib/load.js)) and via the Gateway
  (`pollAlertsViaGateway`, hitting `GET /api/fleet/device/{id}/alerts` — a
  third plugin route this harness adds, since the Gateway had no way to
  surface `last.alerts` before) — `n = 0` on either just means the Worker's
  own snap interval (default 60s) didn't complete a cycle within this run's
  soak, not that induction failed.
- **Storage breakdown**: real on-disk size per Worker store, plus a real
  growth/day computed from size at profile start vs. now, divided by the
  run's own elapsed time (same short-soak "indicative" caveat).
- **Failure behaviour** (`runFailureDrills` in [`processes/run-process.js`](./processes/run-process.js),
  toggled by `RUN_REPRODUCIBILITY.runFailureDrills`, on by default): real
  kill+respawn drills for Worker restart and Kernel restart (both
  processes' identity persists across a restart against the same on-disk
  root, confirmed empirically, so the existing client reconnects on its
  own), plus a device-outage drill. The outage drill can only make the
  **whole fleet** unreachable, not one device — every device behind a
  Worker now shares one mock server — so it reports both the measured
  (fast-refusal, since a closed port is refused immediately rather than
  timing out) and an analytical hung-device worst case
  (`timeout × ⌈device count / concurrency⌉`) from already-known operating
  parameters. Runs once, after the steady-state checklist finishes, never
  during (so it can't contaminate the capacity numbers above).

Left blank, with a note in the generated report: the full push → vote →
execute action-approval workflow as distinct submit/approve/exec/e2e rows,
vote/approve as its own step, and batch actions across N devices in one
call (all three shipped workers whitelist their write actions at a single
required vote, and this harness only ever submits via `sendCommand`/its
Gateway-mirrored route, never the Kernel's separate
`pushAction`/`voteAction`/`queryActions` pipeline); alert generation latency
in isolation (synchronous inside the Worker process, same reason
heap/external memory is blank — needs in-process instrumentation this
harness doesn't have); alert fan-out to N subscribers and historical alert
queries (need Gateway capabilities — a push/subscription mechanism, a
history store — beyond a single request/response endpoint); Kernel-internal
scheduled telemetry pull and health ping (no client-observable start/end
signal distinct from the reads already measured).

## Layout

```
config/benchmark.config.json   the one input file
lib/constants.js               worker-type registry + fixed defaults (never edited to size a run) +
                                 ALERT_INDUCTION (per-family threshold used to trip a real alert) +
                                 RUN_REPRODUCIBILITY.runFailureDrills/*TimeoutMs/deviceOutageMs
lib/site.js                    boot primitives (bootKernel/bootWorker/bootGateway/startMocks) — one
                                 mock server per Worker, and bootWorker wires ALERT_INDUCTION in
lib/metrics.js                 per-process CPU/RSS sampler (ps -o rss,pcpu -p <pid>, every tick) +
                                 open-FD sampler (lsof -p <pid>, start/stop only) + dirSizeBytes
lib/latency.js                 per-operation latency recorder (p50/p95/p99/max/n/errors)
lib/load.js                    read/action load generators, cycle headroom, device baseline,
                                 pollAlerts/pollAlertsViaGateway (alert-visibility latency pollers)
lib/report.js                  pass/fail evaluation + Markdown/JSON report + comparison matrix
lib/sweep-runner.js            spawns one child process per profile, folds results into entries
plugin/fleet-summary/          Gateway plugin every profile run loads: fleet-wide aggregate
                                 (listWorkers→pullTelemetry) plus per-device telemetry/action/alerts
                                 routes (controllers/device-telemetry.js, device-action.js, device-alerts.js)
processes/run-process.js       --role mocks|kernel|worker|gateway|profile (defaults to profile);
                                profile spawns the other four roles as child processes, coordinates
                                the checklist, then (unless disabled) runs runFailureDrills
scenarios/benchmark.js         sweeps the Cartesian product of every config.workers entry's device range, writes one comparison matrix
tests/benchmark.smoke.test.js  fast correctness check (not a capacity claim; skips failure drills for speed)
results/                       generated reports (gitignored)
```

## Adding a device family

[`lib/constants.js`](./lib/constants.js)'s `WORKER_REGISTRY` covers every package under
[`backend/workers/miners/`](../../workers/miners/README.md) (Whatsminer, Antminer, Avalon) — any of them can be
used in `config.workers[].type`. To benchmark a family outside that
directory (container, power meter, ...), add an entry to the registry's
`WORKER_PACKAGES` map pointing at the target package's `start<Type>Worker`
export; everything else (config, load generators, metrics, reporting) is
device-family agnostic because it only talks to the family through
`createMdkClient`.
