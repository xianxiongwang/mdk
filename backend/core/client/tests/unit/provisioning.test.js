'use strict'

// getWorkerKey + createWorkerClient + sendWorkerCommand — hermetic, no network.
// The Kernel client uses the { transport } seam to serve WORKER_LIST (so getStatus
// surfaces a worker rpcKey). The worker-bound client goes through the real
// createWorkerClient -> createRawMdkClient -> HRPCClient path, with an injected
// `rpc` (HRPCClient honors opts.rpc and then never builds a DHT), so we capture
// the exact envelope the worker would receive.

const test = require('brittle')
const { createRawMdkClient, createWorkerClient } = require('../../index')
const { serialize, deserialize } = require('../../../kernel/lib/protocol/envelope')
const { ACTIONS } = require('../../../kernel/lib/protocol/actions')

const WORKER_KEY = 'ab'.repeat(32) // 32-byte hex, valid for HRPCClient

function orkTransport (workers) {
  return {
    connect: async () => {},
    close: async () => {},
    request: async () => ({ workers })
  }
}

// A fake @hyperswarm/rpc: records every request and replies like a worker
// adapter (envelope with a .payload). destroy() is here for completeness but is
// never called — an injected rpc is not owned, so HRPCClient.close() is a no-op.
function fakeWorkerRpc (reply = { payload: { status: 'QUEUED', commandId: 'cmd-1' } }) {
  const rpc = { requests: [] }
  rpc.request = async (key, method, buf) => {
    rpc.requests.push({ key: key.toString('hex'), method, envelope: deserialize(buf) })
    return serialize(reply)
  }
  rpc.destroy = async () => {}
  return rpc
}

test('getWorkerKey - returns the worker rpcKey from the Kernel registry', async (t) => {
  const kernel = createRawMdkClient({ transport: orkTransport([{ workerId: 'miner-worker', state: 'READY', healthState: 'HEALTHY', deviceIds: ['m0'], rpcKey: WORKER_KEY }]) })
  await kernel.connect()
  t.is(await kernel.getWorkerKey('miner-worker'), WORKER_KEY)
})

test('getWorkerKey - returns null for an unregistered worker', async (t) => {
  const kernel = createRawMdkClient({ transport: orkTransport([{ workerId: 'miner-worker', state: 'READY', deviceIds: [], rpcKey: WORKER_KEY }]) })
  await kernel.connect()
  t.is(await kernel.getWorkerKey('ghost-worker'), null)
})

test('createWorkerClient - builds a connectable client over the injected rpc', async (t) => {
  const rpc = fakeWorkerRpc()
  const wc = createWorkerClient(WORKER_KEY, { rpc })
  await wc.connect()
  t.teardown(() => wc.close())
  const res = await wc.sendCommand('m0', 'registerThing', { id: 'm0' })
  t.is(rpc.requests.length, 1, 'request reached the worker rpc')
  t.is(rpc.requests[0].key, WORKER_KEY, 'addressed to the worker key')
  t.is(res.payload.status, 'QUEUED', 'returns the worker reply envelope')
})

test('sendWorkerCommand - resolves the key then sends COMMAND_REQUEST worker-direct', async (t) => {
  const kernel = createRawMdkClient({ transport: orkTransport([{ workerId: 'miner-worker', state: 'READY', deviceIds: [], rpcKey: WORKER_KEY }]) })
  await kernel.connect()
  const rpc = fakeWorkerRpc()

  const params = { id: 'miner-0', info: { pos: '1_1' }, opts: { port: 4028 } }
  const res = await kernel.sendWorkerCommand('miner-worker', 'miner-0', 'registerThing', params, { hrpc: { rpc } })

  t.is(rpc.requests.length, 1, 'exactly one worker request')
  const sent = rpc.requests[0]
  t.is(sent.key, WORKER_KEY, 'sent to the resolved worker key')
  t.is(sent.envelope.action, ACTIONS.COMMAND_REQUEST, 'COMMAND_REQUEST action')
  t.is(sent.envelope.deviceId, 'miner-0', 'deviceId routed')
  t.is(sent.envelope.payload.command, 'registerThing', 'command name carried')
  t.alike(sent.envelope.payload.params, params, 'params carried verbatim')
  t.is(res.payload.status, 'QUEUED', 'returns the worker reply')
})

test('sendWorkerCommand - throws ERR_MDK_WORKER_KEY_UNKNOWN for an unregistered worker', async (t) => {
  const kernel = createRawMdkClient({ transport: orkTransport([]) })
  await kernel.connect()
  const rpc = fakeWorkerRpc()

  await t.exception(() => kernel.sendWorkerCommand('ghost', 'd0', 'registerThing', {}, { hrpc: { rpc } }), /ERR_MDK_WORKER_KEY_UNKNOWN/)
  t.is(rpc.requests.length, 0, 'no worker request attempted when the key is unknown')
})

test('pullWorkerTelemetry - resolves the key, sends TELEMETRY_PULL worker-direct, unwraps the payload', async (t) => {
  const kernel = createRawMdkClient({ transport: orkTransport([{ workerId: 'miner-worker', state: 'READY', deviceIds: [], rpcKey: WORKER_KEY }]) })
  await kernel.connect()
  const rows = [{ ts: 1700000000000, hashrate_sum: 42 }]
  const rpc = fakeWorkerRpc({ payload: { logs: rows, timestamp: 1700000000001 } })

  const query = { type: 'logs', key: 'stat-1D', tag: 't-miner', start: 1, end: 2, fields: { hashrate_sum: 1 } }
  const res = await kernel.pullWorkerTelemetry('miner-worker', query, { hrpc: { rpc } })

  t.is(rpc.requests.length, 1, 'exactly one worker request')
  const sent = rpc.requests[0]
  t.is(sent.key, WORKER_KEY, 'sent to the resolved worker key')
  t.is(sent.envelope.action, ACTIONS.TELEMETRY_PULL, 'TELEMETRY_PULL action')
  t.is(sent.envelope.deviceId, null, 'worker-scoped: no device routing')
  t.alike(sent.envelope.payload.query, query, 'query carried verbatim')
  t.alike(res.logs, rows, 'resolves with the bare telemetry payload')
})

test('pullWorkerTelemetry - throws ERR_MDK_WORKER_KEY_UNKNOWN for an unregistered worker', async (t) => {
  const kernel = createRawMdkClient({ transport: orkTransport([]) })
  await kernel.connect()
  const rpc = fakeWorkerRpc()

  await t.exception(() => kernel.pullWorkerTelemetry('ghost', { type: 'logs' }, { hrpc: { rpc } }), /ERR_MDK_WORKER_KEY_UNKNOWN/)
  t.is(rpc.requests.length, 0, 'no worker request attempted when the key is unknown')
})
