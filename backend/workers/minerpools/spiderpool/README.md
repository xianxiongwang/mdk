# @tetherto/mdk-worker-spiderpool

MDK Worker for the SpiderPool Bitcoin mining pool. Fetches hashrate, worker stats, and earnings via the SpiderPool REST API.

## Install

```bash
npm install @tetherto/mdk-worker-spiderpool
```

## Usage

`startSpiderpoolWorker(opts)` boots a single logical device on `WorkerRuntime` — the pool subaccount list is
configuration passed at boot, not a `registerThing`-provisioned device:

```js
const { getKernel } = require('@tetherto/mdk')
const { startSpiderpoolWorker } = require('@tetherto/mdk-worker-spiderpool')

const kernel = await getKernel()

const worker = await startSpiderpoolWorker({
  workerId: 'spiderpool-site-1',
  rack: 'site-1',
  storeDir: './store/spiderpool-site-1',
  conf: {
    spiderpool: {
      accounts: ['my-subaccount'],
      accessKey: 'your-access-key',
      privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
      apiUrl: 'https://api.spiderpool.com'
    }
  }
})
await kernel.registerWorker(worker.runtime.getPublicKey())
```

| `opts` field | Type | Status | Notes |
| --- | --- | --- | --- |
| `workerId` | string | Required | One runtime process = one `workerId`. |
| `rack` | string | Required | Rack identifier; also the pool store prefix. |
| `storeDir` | string | Required | Persistent store directory. |
| `conf.spiderpool.accounts` | string[] | Required | SpiderPool subaccount names to poll. |
| `conf.spiderpool.accessKey` | string | Required | Access key from the SpiderPool website's Account Management section. |
| `conf.spiderpool.privateKey` | string | Required | RSA private key whose public half is registered with SpiderPool; used for MD5withRSA request signing. Accepts the console's bare base64 body as well as a PKCS#8/PKCS#1 PEM block (see below). |
| `conf.spiderpool.apiUrl` | string | Optional | Defaults to the SpiderPool API base URL (`https://api.spiderpool.com`). |
| `conf.spiderpool.coin` | string | Optional | Currency abbreviation, defaults to `btc`. |
| `kernelTopic` | string | Optional | DHT discovery topic (hex); omit to register directly with `kernel.registerWorker()`. |

## Telemetry

| Field | Unit | Description |
|-------|------|-------------|
| `hashrate` | TH/s | Pool-reported hashrate for this subaccount |
| `workers_online` | — | Number of active worker connections |
| `balance` | BTC | Current unpaid balance |
| `estimated_earnings` | BTC | Estimated daily earnings |

## Protocol

Uses the [SpiderPool REST API](https://support.spiderpool.com/spiderpool-api/miningpool-api) over HTTPS. Every
request carries the unified envelope `{ dataJson, accessKey, timestamp, sign }`, where `sign` is the base64
MD5withRSA signature of `` `${dataJson}|${timestamp}` `` produced with the account's RSA private key.

### Response envelope

Responses are `{ code, msg, data }`, but the success code is **not** uniform and the published docs
only mention one of them. Verified against the live API:

| Endpoint namespace | Success code |
|---|---|
| `/v2/subaccount/*` (profit info, payment records) | `"SUCCESS"` |
| `/v2/sp/*` (hashrate, worker list, charts) | `200` |

`isSuccessCode` in [`lib/utils`](./lib/utils/index.js) matches against `SUCCESS_CODES`, so both pass.
Do not narrow this back to a single literal — half the endpoints will start failing with
`ERR_SPIDERPOOL_API … 200`. The mock server reproduces the split so tests cover both.

### Private key format

The SpiderPool console issues the key as a **bare base64 body with no PEM armour** (what Java's
`PKCS8EncodedKeySpec` consumes). Pass it through verbatim — `normalizePrivateKey` in
[`lib/utils`](./lib/utils/index.js) accepts the bare base64 body (single- or multi-line), a PKCS#8 or
PKCS#1 PEM block, and PEM carrying literal `\n` escapes from JSON config or env vars. A key that is
neither (a public key, say) fails at `init()` with `ERR_SPIDERPOOL_PRIVATE_KEY_INVALID`.

## Health

**States:** `OK`, `DEGRADED`, `OFFLINE`

## Mock Server

Run the mock standalone (spiderpool has no model `type`):

```bash
npm run mock
```

Programmatic:

```js
const spiderpoolMock = require('@tetherto/mdk-worker-spiderpool/mock/server')
spiderpoolMock.createServer({ port: 5031, host: '127.0.0.1' })
```

The mock verifies the real signing envelope against a bundled throwaway RSA test keypair
(`mock/lib/test-keys.js`) — use `TEST_ACCESS_KEY` / `TEST_PRIVATE_KEY` from that module when driving it.

## Testing

```bash
cd backend/workers/minerpools/spiderpool
npm test
```
