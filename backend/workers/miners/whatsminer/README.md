# @tetherto/mdk-worker-whatsminer

MDK Worker for MicroBT Whatsminer Bitcoin miners. Supports the M30SP, M30SPP, M53S, M56S, and M63 model families.

## Supported Models

| `model` value | Model | Notes |
|--------|-------|-------|
| `m30sp` | M30S+ | — |
| `m30spp` | M30S++ | — |
| `m53s` | M53S | — |
| `m56s` | M56S | Used in examples |
| `m63` | M63 | Extra `setUpfreqSpeed` command |

## Install

```bash
npm install @tetherto/mdk-worker-whatsminer
```

## Usage

```js
const { getKernel } = require('@tetherto/mdk')
const { startWhatsminerWorker } = require('@tetherto/mdk-worker-whatsminer')

const kernel = await getKernel()

const worker = await startWhatsminerWorker({
  workerId: 'whatsminer-rack-1',
  model: 'm56s',
  storeDir: './store/whatsminer-rack-1',
  seedDevices: [{
    info: {
      serialNum: 'WM56S-001',
      container: 'container-A',
      pos: 'A1',
      location: 'site-a-01.container'
    },
    opts: {
      address: '192.168.1.10',
      port: 4028,             // API v2 default (4433 for v3); omit to auto-detect
      password: 'admin'
    }
  }]
})
await kernel.registerWorker(worker.runtime.getPublicKey())
```

`seedDevices` only seeds a fresh, empty `storeDir`. To add a device to an already-running Worker, send the
`registerThing` command over HRPC instead — see [USAGE.md](USAGE.md#registering-devices) for the full pattern and the
restart-required caveat.

## Protocol

Whatsminer devices speak one of two API generations. The Worker auto-detects which:

| API version | Default port | Auth command |
| --- | --- | --- |
| v2 (default) | `4028` | `get_token` |
| v3 | `4433` | `get.device.info` |

`opts.port === 4028` or `4433` short-circuits detection to v2 or v3 respectively; any other port probes both
auth commands and falls back to v2. Pass `opts.apiVersion` (e.g. `'3.0.3'`) to skip detection entirely.

Callers always use v2-style command names (`get_miner_info`, underscore notation); against a v3 device the
Worker translates them to v3's dot notation (`get.miner.info`) internally, and back-translates the response
shape (`{code, when, msg, desc}` → the v2-compatible shape).

Authentication differs by version: v2 uses a salted MD5-crypt challenge-response token; v3 generates a fresh
SHA-256-derived token per command. Both encrypt write payloads with AES-256 (ECB mode, key derived from the
device password).

## Telemetry

Live metrics collected on each poll cycle:

| Field | Unit | Description |
|-------|------|-------------|
| `hashrate_rt` | TH/s | Real-time hashrate |
| `hashrate_avg` | TH/s | Average hashrate |
| `power` | W | Current power draw |
| `temperature` | °C | Chip temperature |
| `fan_speed_in` | RPM | Inlet fan speed |
| `fan_speed_out` | RPM | Outlet fan speed |
| `status` | — | Device operational status |
| `uptime` | s | Seconds since last boot |
| `accepted_shares` | — | Total accepted shares |
| `rejected_shares` | — | Total rejected shares |
| `pool_url` | — | Active pool URL |
| `efficiency` | W/TH | Power efficiency ratio |
| `power_mode` | — | Current power mode (e.g. `normal`, `low`, `high`) |

## Commands

| Command | Parameters | Notes |
|---------|-----------|-------|
| `reboot` | — | Takes 2–3 min to resume; max once per 5 min |
| `setPowerMode` | `mode: string` | e.g. `normal`, `low`, `high`, `sleep` |
| `setLED` | `enabled: boolean` | Physical LED blink |
| `setupPools` | `pools: object` | Pool URL, worker, password |
| `setPowerPct` | `pct: number (0–100)` | Fine-grained power control |
| `downloadLogs` | — | Pull raw diagnostic logs from hardware |

Plus the standard device management commands: `registerThing`, `updateThing`, `forgetThings`, `saveSettings`, `saveComment`, `editComment`, `deleteComment`.

## Health

**States:** `OK`, `DEGRADED`, `OFFLINE`

**Alerts:**
- `alert.overheat` — chip temperature exceeded threshold
- `alert.fan_failure` — fan RPM below required minimum (fan RPM = 0 is mechanical failure)
- `alert.psu_failure` — power supply unit error
- `alert.hashrate_low` — hashrate below expected (may be board tuning — wait 15 min before escalating)

**Troubleshooting rules (from contract):**
- If `alert.overheat`: verify fan speeds. Fan speed of 0 is a mechanical failure.
- If `alert.hashrate_low`: miner may be tuning boards — wait 15 minutes.
- If status is `OFFLINE`: do not attempt reboot. Escalate to operator.

## Development with Mock Server

The package ships a mock TCP server that simulates the Whatsminer API v2 protocol. Examples bind it to `14028`
rather than the real v2 default (`4028`) so it doesn't collide with the Avalon mock, which binds its own real
default (`4028`); [`examples/full-site`](../../../../examples/full-site/README.md) runs both simultaneously. Pick any free port for standalone use.

```js
const wmMock = require('@tetherto/mdk-worker-whatsminer/mock/server')

wmMock.createServer({
  port: 14028,
  host: '127.0.0.1',
  type: 'm56s',
  serial: 'WM-001',
  password: 'admin'
})
```

## Testing

```bash
cd backend/workers/miners/whatsminer
npm test
```
