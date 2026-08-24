'use strict'

// Unit tests for the MCP server component:
//   - tool handler behaviour (registerTools) via a fake Client
//   - spawnDescriptor and COMPONENTS membership for mcp-server
//   - dispatcher dependency enforcement (Kernel required before mcp-server)
//   - MCP_PORT export from backend/site

const test = require('brittle')
const path = require('path')

const { registerTools, classifyDevice, AXIS, AGENT_META_KEY, TOOL_CONTRACT_VERSION } = require('../../backend/proc/mcp-server')
const { z } = require('zod')
const { spawnDescriptor, resolveProcName, COMPONENTS } = require('../../cli/commands/components')
const { createDispatcher } = require('../../cli/commands')
const { MCP_PORT } = require('../../backend/site')

const SITE = path.join(__dirname, '..', '..')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A fake Client whose methods return controllable responses.
function fakeClient (overrides = {}) {
  return {
    getStatus: async () => ({
      workers: [
        { workerId: 'whatsminer-worker', state: 'READY', healthState: 'HEALTHY', deviceIds: ['wm001', 'wm002'], deviceCount: 2, rpcKey: 'aa'.repeat(32) }
      ],
      totalDevices: 2
    }),
    getCapabilities: async (deviceId) => ({
      deviceId,
      commands: [{ name: 'reboot', params: {} }, { name: 'setPowerMode', params: { mode: 'string' } }]
    }),
    pullTelemetry: async (deviceId, query) => ({
      deviceId,
      query,
      metrics: { hashrate_mhs: 100e6, power_w: 3300 }
    }),
    pullState: async (deviceId) => ({
      deviceId,
      state: { status: 'mining', power_mode: 'normal' }
    }),
    sendCommand: async (deviceId, command, params) => ({
      commandId: 'cmd-1',
      deviceId,
      command,
      params,
      status: 'QUEUED'
    }),
    ...overrides
  }
}

// Capture tool handlers registered via server.registerTool() without the McpServer HTTP stack.
function captureTools (client) {
  const tools = {}
  const mockServer = {
    registerTool (name, _config, handler) {
      tools[name] = handler
    }
  }
  registerTools(mockServer, client)
  return tools
}

function captureConfigs (client) {
  const configs = {}
  registerTools({ registerTool (name, config) { configs[name] = config } }, client)
  return configs
}

// ---------------------------------------------------------------------------
// Tool: get_status
// ---------------------------------------------------------------------------

test('get_status returns serialised worker list', async (t) => {
  const tools = captureTools(fakeClient())
  const result = await tools.get_status({})
  t.is(result.content.length, 1)
  t.is(result.content[0].type, 'text')
  const parsed = JSON.parse(result.content[0].text)
  t.is(parsed.workers.length, 1)
  t.is(parsed.workers[0].workerId, 'whatsminer-worker')
  t.is(parsed.totalDevices, 2)
})

test('get_status forwards client errors', async (t) => {
  const client = fakeClient({ getStatus: async () => { throw new Error('ERR_TIMEOUT') } })
  const tools = captureTools(client)
  await t.exception(() => tools.get_status({}), /ERR_TIMEOUT/)
})

// ---------------------------------------------------------------------------
// Tool: get_capabilities
// ---------------------------------------------------------------------------

test('get_capabilities returns command schema for the device', async (t) => {
  const tools = captureTools(fakeClient())
  const result = await tools.get_capabilities({ deviceId: 'wm001' })
  const parsed = JSON.parse(result.content[0].text)
  t.is(parsed.deviceId, 'wm001')
  t.ok(Array.isArray(parsed.commands))
  t.ok(parsed.commands.some((c) => c.name === 'reboot'))
})

test('get_capabilities passes the deviceId through', async (t) => {
  let seen
  const client = fakeClient({
    getCapabilities: async (deviceId) => { seen = deviceId; return { deviceId, commands: [] } }
  })
  const tools = captureTools(client)
  await tools.get_capabilities({ deviceId: 'am007' })
  t.is(seen, 'am007')
})

// ---------------------------------------------------------------------------
// Tool: pull_telemetry
// ---------------------------------------------------------------------------

test('pull_telemetry passes the zod-defaulted query "metrics" to the client', async (t) => {
  let seenQuery
  const client = fakeClient({
    pullTelemetry: async (deviceId, query) => { seenQuery = query; return { deviceId, query } }
  })
  const tools = captureTools(client)
  // zod applies .default('metrics') before the handler runs; pass that value explicitly here
  await tools.pull_telemetry({ deviceId: 'wm001', query: 'metrics' })
  t.is(seenQuery, 'metrics')
})

test('pull_telemetry passes an explicit query through', async (t) => {
  let seenQuery
  const client = fakeClient({
    pullTelemetry: async (deviceId, query) => { seenQuery = query; return { deviceId, query } }
  })
  const tools = captureTools(client)
  await tools.pull_telemetry({ deviceId: 'wm001', query: 'logs' })
  t.is(seenQuery, 'logs')
})

test('pull_telemetry returns serialised result', async (t) => {
  const tools = captureTools(fakeClient())
  const result = await tools.pull_telemetry({ deviceId: 'wm001', query: 'metrics' })
  const parsed = JSON.parse(result.content[0].text)
  t.is(parsed.deviceId, 'wm001')
  t.ok(parsed.metrics)
})

// ---------------------------------------------------------------------------
// Tool: pull_state
// ---------------------------------------------------------------------------

test('pull_state returns serialised device state', async (t) => {
  const tools = captureTools(fakeClient())
  const result = await tools.pull_state({ deviceId: 'wm001' })
  const parsed = JSON.parse(result.content[0].text)
  t.is(parsed.deviceId, 'wm001')
  t.is(parsed.state.status, 'mining')
})

test('pull_state passes deviceId to the client', async (t) => {
  let seen
  const client = fakeClient({ pullState: async (deviceId) => { seen = deviceId; return { deviceId } } })
  const tools = captureTools(client)
  await tools.pull_state({ deviceId: 'av003' })
  t.is(seen, 'av003')
})

// ---------------------------------------------------------------------------
// Tool: send_command
// ---------------------------------------------------------------------------

test('send_command dispatches the command and returns the result', async (t) => {
  const calls = []
  const client = fakeClient({
    sendCommand: async (deviceId, command, params) => {
      calls.push({ deviceId, command, params })
      return { commandId: 'cmd-42', status: 'QUEUED' }
    }
  })
  const tools = captureTools(client)
  const result = await tools.send_command({ deviceId: 'wm001', command: 'reboot', params: {} })
  t.is(calls.length, 1)
  t.is(calls[0].deviceId, 'wm001')
  t.is(calls[0].command, 'reboot')
  const parsed = JSON.parse(result.content[0].text)
  t.is(parsed.commandId, 'cmd-42')
  t.is(parsed.status, 'QUEUED')
})

test('send_command passes the zod-defaulted params {} to the client', async (t) => {
  let seenParams
  const client = fakeClient({
    sendCommand: async (_deviceId, _command, params) => { seenParams = params; return {} }
  })
  const tools = captureTools(client)
  // zod applies .default({}) before the handler runs; pass that value explicitly here
  await tools.send_command({ deviceId: 'wm001', command: 'reboot', params: {} })
  t.alike(seenParams, {})
})

test('send_command forwards client errors', async (t) => {
  const client = fakeClient({
    sendCommand: async () => { throw new Error('ERR_DEVICE_OFFLINE') }
  })
  const tools = captureTools(client)
  await t.exception(() => tools.send_command({ deviceId: 'wm001', command: 'reboot' }), /ERR_DEVICE_OFFLINE/)
})

// ---------------------------------------------------------------------------
// registerTools: the legacy tools plus the agent-facing ones
// ---------------------------------------------------------------------------

test('registerTools registers the legacy tools and the agent-facing ones', (t) => {
  const names = []
  const mockServer = { registerTool (name) { names.push(name) } }
  registerTools(mockServer, fakeClient())
  t.alike(names.sort(), [
    'act_device', 'count_devices', 'get_capabilities', 'get_device', 'get_site_overview',
    'get_status', 'get_supported_power_modes', 'list_devices', 'pull_state', 'pull_telemetry',
    'rank_devices', 'send_command', 'summarize_site'
  ])
})

test('every tool declares its mutability, and only the two action tools write', (t) => {
  const configs = captureConfigs(fakeClient())

  const undeclared = Object.keys(configs).filter((name) => typeof configs[name].annotations?.readOnlyHint !== 'boolean')
  t.alike(undeclared, [], 'every tool declares readOnlyHint, so approval keys off the tool itself')

  const writes = Object.keys(configs).filter((name) => configs[name].annotations.readOnlyHint === false)
  t.alike(writes.sort(), ['act_device', 'send_command'])
})

test('only the agent-facing tools carry agent metadata', (t) => {
  const configs = captureConfigs(fakeClient())
  const withMeta = Object.keys(configs).filter((name) => configs[name]._meta?.['x-mdk-agent']?.enabled).sort()

  t.alike(withMeta, ['act_device', 'count_devices', 'get_device', 'list_devices', 'rank_devices', 'summarize_site'],
    'the legacy tools stay available to other consumers but are withheld from the model')
})

// ---------------------------------------------------------------------------
// Agent-facing tools: every result carries a summary the model can speak verbatim
// ---------------------------------------------------------------------------

const mixedFleet = () => fakeClient({
  getStatus: async () => ({
    workers: [
      { workerId: 'antminer-worker', state: 'READY', deviceIds: ['antminer-0', 'antminer-1'] },
      { workerId: 'container-worker', state: 'DISCOVERED', deviceIds: ['container-1'] }
    ]
  })
})

test('summarize_site rolls up workers and devices, naming what is offline', async (t) => {
  const tools = captureTools(mixedFleet())
  const parsed = JSON.parse((await tools.summarize_site({})).content[0].text)

  t.is(parsed.totals.workers.total, 2)
  t.is(parsed.totals.devices.total, 3)
  t.is(parsed.totals.devices.offline, 1)
  t.alike(parsed.totals.devices.byFamily.miner, { total: 2, online: 2 })
  t.ok(parsed.summary.includes('container-1'), 'the offline device is named in the summary')
})

test('count_devices counts one family without listing it', async (t) => {
  const tools = captureTools(mixedFleet())
  const parsed = JSON.parse((await tools.count_devices({ family: 'miner', state: 'all' })).content[0].text)

  t.is(parsed.count, 2)
  t.is(parsed.summary, '2 miners.')
  t.absent(parsed.items, 'counting does not return the rows')
})

test('count_devices narrows by state', async (t) => {
  const tools = captureTools(mixedFleet())
  const parsed = JSON.parse((await tools.count_devices({ family: 'all', state: 'offline' })).content[0].text)

  t.is(parsed.count, 1)
  t.is(parsed.summary, '1 offline device.', 'a single match reads as one device, since the model speaks this verbatim')
})

test('list_devices names each match', async (t) => {
  const tools = captureTools(mixedFleet())
  const parsed = JSON.parse((await tools.list_devices({ family: 'miner', state: 'all', limit: 50 })).content[0].text)

  t.is(parsed.count, 2)
  t.is(parsed.total, 2)
  t.alike(parsed.items.map((d) => d.deviceId), ['antminer-0', 'antminer-1'])
  t.ok(parsed.summary.includes('antminer-0'))
  t.absent(parsed.summary.includes('showing'), 'nothing was cut, so nothing is claimed to be')
})

test('list_devices says so plainly when nothing matches', async (t) => {
  const tools = captureTools(mixedFleet())
  const parsed = JSON.parse((await tools.list_devices({ family: 'pool', state: 'all', limit: 50 })).content[0].text)

  t.is(parsed.count, 0)
  t.is(parsed.summary, 'No pools match.')
})

test('list_devices caps the rows it names and says the list is a subset', async (t) => {
  const tools = captureTools(fleetOf(60))
  const parsed = JSON.parse((await tools.list_devices({ family: 'miner', state: 'all', limit: 3 })).content[0].text)

  t.is(parsed.items.length, 3, 'only the requested rows come back')
  t.is(parsed.count, 3, 'count is what is shown — the contract ties it to items.length')
  t.is(parsed.total, 60, 'and the full match count is still reported')
  t.ok(parsed.summary.includes('3 of 60'), 'the summary states both numbers rather than claiming 60 names')
  t.absent(parsed.summary.includes('antminer-3'), 'and names only the rows it returned')
})

test('list_devices default limit answers a whole demo-sized fleet', async (t) => {
  const configs = captureConfigs(fakeClient())
  const limit = z.toJSONSchema(z.object(configs.list_devices.inputSchema)).properties.limit
  t.is(limit.type, 'integer', 'a bounded integer, as the agent tool contract requires')
  t.is(limit.minimum, 1)
  t.is(limit.maximum, 50)

  const tools = captureTools(fleetOf(26))
  const parsed = JSON.parse((await tools.list_devices({ family: 'miner', state: 'all', limit: limit.default })).content[0].text)
  t.is(parsed.count, 26, 'the 26-device demo still lists whole under the default')
})

test('get_device routes each attribute to the right client call', async (t) => {
  const tools = captureTools(mixedFleet())

  const telemetry = JSON.parse((await tools.get_device({ ref: 'antminer-0', attr: 'telemetry' })).content[0].text)
  t.is(telemetry.value.query, 'metrics', 'telemetry is always pulled as metrics')

  const state = JSON.parse((await tools.get_device({ ref: 'antminer-0', attr: 'state' })).content[0].text)
  t.is(state.value.state.status, 'mining')

  const caps = JSON.parse((await tools.get_device({ ref: 'antminer-0', attr: 'capabilities' })).content[0].text)
  t.is(caps.value.commands.length, 2)

  const modes = JSON.parse((await tools.get_device({ ref: 'antminer-0', attr: 'power_modes' })).content[0].text)
  t.alike(modes.value, ['sleep', 'normal'])
})

// Every attribute answers under the same key, so the model reads one field rather than
// learning which key each attribute hides behind.
test('get_device returns every attribute under ref/attr/value', async (t) => {
  const tools = captureTools(mixedFleet())

  for (const attr of ['telemetry', 'state', 'capabilities', 'power_modes']) {
    const parsed = JSON.parse((await tools.get_device({ ref: 'antminer-0', attr })).content[0].text)
    t.alike([parsed.ref, parsed.attr], ['antminer-0', attr], `${attr} echoes what was asked`)
    t.not(parsed.value, undefined, `${attr} answers under value`)
  }
})

test('rank_devices orders by a metric and reports what did not answer', async (t) => {
  const client = mixedFleet()
  client.pullTelemetry = async (deviceId) => {
    if (deviceId === 'antminer-1') throw new Error('CHANNEL_DESTROYED')
    return { deviceId, metrics: { power: 3300 } }
  }
  const tools = captureTools(client)
  const parsed = JSON.parse((await tools.rank_devices({ family: 'miner', metric: 'power', order: 'asc', limit: 5 })).content[0].text)

  t.is(parsed.items.length, 1, 'the device whose telemetry failed is skipped, not fatal')
  t.is(parsed.unavailable, 1)
  t.ok(parsed.summary.includes('did not report'), 'and the gap is stated rather than hidden')
})

// The mode enum is the union across families, so a mode valid for one device is offered for all.
test('act_device refuses a power mode the device does not support', async (t) => {
  const client = mixedFleet()
  let dispatched = false
  client.sendCommand = async (...args) => { dispatched = true; return { status: 'QUEUED', args } }
  const tools = captureTools(client)

  // antminer accepts sleep|normal only.
  const parsed = JSON.parse((await tools.act_device({ ref: 'antminer-0', action: 'set_power_mode', mode: 'high' })).content[0].text)
  t.absent(dispatched, 'nothing reaches the device')
  t.ok(parsed.summary.includes('does not support'), 'and the operator is told why')
  t.alike(parsed.supportedPowerModes, ['sleep', 'normal'])

  const ok = JSON.parse((await tools.act_device({ ref: 'antminer-0', action: 'set_power_mode', mode: 'sleep' })).content[0].text)
  t.ok(dispatched, 'a supported mode still dispatches')
  t.ok(ok.summary.includes('sleep'))
})

test('act_device passes the mode only when setting a power mode', async (t) => {
  const tools = captureTools(mixedFleet())

  const reboot = JSON.parse((await tools.act_device({ ref: 'antminer-0', action: 'reboot', mode: 'normal' })).content[0].text)
  t.alike(reboot.result.params, {}, 'reboot takes no parameters')

  const mode = JSON.parse((await tools.act_device({ ref: 'antminer-0', action: 'set_power_mode', mode: 'sleep' })).content[0].text)
  t.alike(mode.result.params, { mode: 'sleep' })
  t.ok(mode.summary.includes('sleep'))
})

// ---------------------------------------------------------------------------
// CLI components: spawnDescriptor and COMPONENTS
// ---------------------------------------------------------------------------

test('COMPONENTS includes mcp-server', (t) => {
  t.ok(COMPONENTS.includes('mcp-server'))
})

test('resolveProcName resolves mcp-server to itself', (t) => {
  t.is(resolveProcName('mcp-server'), 'mcp-server')
})

test('spawnDescriptor for mcp-server has correct procName, entry, and argv', (t) => {
  const ctx = { siteDir: SITE, root: '/x', httpPort: 3007, uiPort: 3040, mcpPort: 3008 }
  const desc = spawnDescriptor(ctx, 'mcp-server')
  t.is(desc.procName, 'mcp-server')
  t.ok(desc.entry.endsWith(path.join('backend', 'proc', 'mcp-server.js')))
  t.ok(desc.argv.includes('--root'))
  t.ok(desc.argv.includes('/x'))
  t.ok(desc.argv.includes('--port'))
  t.ok(desc.argv.includes('3008'))
})

test('spawnDescriptor uses ctx.mcpPort when set', (t) => {
  const ctx = { siteDir: SITE, root: '/x', httpPort: 3007, uiPort: 3040, mcpPort: 4000 }
  const desc = spawnDescriptor(ctx, 'mcp-server')
  t.ok(desc.argv.includes('4000'))
})

test('spawnDescriptor falls back to MCP_PORT when ctx.mcpPort is absent', (t) => {
  const ctx = { siteDir: SITE, root: '/x', httpPort: 3007, uiPort: 3040 }
  const desc = spawnDescriptor(ctx, 'mcp-server')
  t.ok(desc.argv.includes(String(MCP_PORT)))
})

// ---------------------------------------------------------------------------
// Dispatcher: start mcp-server requires Kernel
// ---------------------------------------------------------------------------

test('dispatcher: start mcp-server is blocked when Kernel is not running', async (t) => {
  const out = []
  const ctx = {
    pm: { isAlive: () => false, has: () => false },
    root: '/none',
    siteDir: SITE,
    httpPort: 3007,
    uiPort: 3040,
    mcpPort: 3008,
    print: (s) => out.push(s)
  }
  const { dispatch } = createDispatcher(ctx)
  await dispatch('start mcp-server')
  t.is(out[0], 'ERR_KERNEL_NOT_RUNNING')
})

test('dispatcher: start mcp-server succeeds when Kernel is alive (component lookup)', async (t) => {
  const spawned = []
  const pm = {
    isAlive: (name) => name === 'kernel',
    has: () => false,
    spawn: (name, entry, argv) => {
      spawned.push({ name, entry, argv })
      const child = { stdout: { on () {} }, stderr: { on () {} }, on () {} }
      return { child, status: 'starting' }
    },
    waitForReady: async () => {}
  }
  const out = []
  const ctx = { pm, root: '/none', siteDir: SITE, httpPort: 3007, uiPort: 3040, mcpPort: 3008, print: (s) => out.push(s) }
  const { dispatch } = createDispatcher(ctx)
  await dispatch('start mcp-server')
  t.is(spawned.length, 1)
  t.is(spawned[0].name, 'mcp-server')
  t.ok(out[0].includes('mcp-server'))
})

// ---------------------------------------------------------------------------
// MCP_PORT export
// ---------------------------------------------------------------------------

test('MCP_PORT is exported from backend/site and is a positive number', (t) => {
  t.ok(typeof MCP_PORT === 'number')
  t.ok(MCP_PORT > 0)
})

test('MCP_PORT defaults to 3008', (t) => {
  // Only asserting the default value when the env var is not set.
  if (!process.env.MDK_MCP_PORT) t.is(MCP_PORT, 3008)
  else t.pass('MDK_MCP_PORT env var is set; skipping default assertion')
})

// ---------------------------------------------------------------------------
// classifyDevice / normStatus / normType (the metadata-mapping helpers)
// ---------------------------------------------------------------------------

test('classifyDevice maps every miner family, including the whatsminer spelling', (t) => {
  t.is(classifyDevice('antminer-0'), 'miner')
  t.is(classifyDevice('avalon-3'), 'miner')
  t.is(classifyDevice('whatsminer-2'), 'miner') // regression: was mis-spelled "whtsminer" once
  t.is(classifyDevice('whtsminer-1'), 'miner')
})

test('classifyDevice maps the non-miner device types', (t) => {
  t.is(classifyDevice('container-1'), 'container')
  t.is(classifyDevice('container-antspace'), 'container')
  t.is(classifyDevice('site-sensor-microbt'), 'sensor')
  t.is(classifyDevice('site-powermeter'), 'powermeter')
  t.is(classifyDevice('site-satec-powermeter'), 'powermeter')
  t.is(classifyDevice('f2pool-worker'), 'pool')
  t.is(classifyDevice('minerpool-worker'), 'pool')
})

test('classifyDevice returns other for unknown ids', (t) => {
  t.is(classifyDevice('gizmo-9'), 'other')
})

test('classifyDevice prefers the reported device family over id shape', (t) => {
  t.is(classifyDevice('weird-name-1', 'miner'), 'miner') // family wins where id would be "other"
  t.is(classifyDevice('x', 'power-meter'), 'powermeter') // contract spelling mapped
  t.is(classifyDevice('y', 'minerpool'), 'pool')
  t.is(classifyDevice('antminer-0', 'sensor'), 'sensor') // family overrides an id that looks like a miner
})

// ---------------------------------------------------------------------------
// The agent contract: compliance is a silent skip, so it has to be asserted
// ---------------------------------------------------------------------------

// Converts the zod shapes the way McpServer does, so the descriptors match what a client
// receives — otherwise the contract is checked against something that never goes on the wire.
function agentDescriptors (client) {
  return Object.entries(captureConfigs(client))
    .filter(([, config]) => config._meta)
    .map(([name, config]) => ({
      name,
      description: config.description,
      inputSchema: Object.keys(config.inputSchema ?? {}).length
        ? z.toJSONSchema(z.object(config.inputSchema))
        : { type: 'object', properties: {} },
      annotations: config.annotations,
      _meta: config._meta
    }))
}

test('every agent-facing tool satisfies the contract, so none is silently skipped', async (t) => {
  const { validateTool, admitTools } = await import('../../../../backend/core/agent/src/tools.js')
  const descriptors = agentDescriptors(fakeClient())

  for (const descriptor of descriptors) {
    const { ok, errors } = validateTool(descriptor)
    t.ok(ok, `${descriptor.name}: ${errors.join(' | ')}`)
  }

  const { admitted } = admitTools(descriptors)
  t.alike(admitted.map((tool) => tool.name).sort(),
    ['act_device', 'count_devices', 'get_device', 'list_devices', 'rank_devices', 'summarize_site'],
    'all six are admitted — a dropped .int() or a zod change would empty this')
})

test('the vocabularies restated here still match the contract', async (t) => {
  const contract = await import('../../../../backend/core/agent/src/tools.js')

  // Compare the key sets first: iterating only this file's keys would pass while the contract
  // grew an axis this copy never restated, which is drift in the direction that matters.
  t.alike(Object.keys(AXIS).sort(), Object.keys(contract.AXIS).sort(), 'the same axes exist on both sides')
  for (const axis of Object.keys(contract.AXIS)) {
    t.alike(AXIS[axis], contract.AXIS[axis], `AXIS.${axis} matches the contract`)
  }
  t.is(AGENT_META_KEY, contract.AGENT_META_KEY, 'the metadata key matches')
  // Drift here is silent and total: this server would declare a version the agent does not
  // speak, every tool would be skipped as such, and the agent would start cleanly and then
  // answer nothing about the fleet.
  t.is(TOOL_CONTRACT_VERSION, contract.TOOL_CONTRACT_VERSION, 'and so does the contract version')
})

// ---------------------------------------------------------------------------
// rank_devices reads telemetry in bounded batches
// ---------------------------------------------------------------------------

function fleetOf (count) {
  const deviceIds = Array.from({ length: count }, (_, i) => `antminer-${i}`)
  return fakeClient({
    getStatus: async () => ({ workers: [{ workerId: 'antminer-worker', state: 'READY', deviceIds }] })
  })
}

test('rank_devices reads every device exactly once, whatever the fleet size', async (t) => {
  for (const size of [0, 1, 20]) {
    const client = fleetOf(size)
    const seen = []
    client.pullTelemetry = async (deviceId) => {
      seen.push(deviceId)
      return { deviceId, metrics: { power: 3000 + seen.length } }
    }
    const tools = captureTools(client)
    const parsed = JSON.parse((await tools.rank_devices({ family: 'miner', metric: 'power', order: 'desc', limit: 50 })).content[0].text)

    t.is(seen.length, size, `${size} devices: one read each`)
    t.is(new Set(seen).size, size, `${size} devices: no device read twice`)
    t.is(parsed.items.length, size, `${size} devices: all ranked`)
  }
})

test('rank_devices honours limit and order across a batch boundary', async (t) => {
  const client = fleetOf(20)
  client.pullTelemetry = async (deviceId) => ({ deviceId, metrics: { power: Number(deviceId.split('-')[1]) } })
  const tools = captureTools(client)
  const parsed = JSON.parse((await tools.rank_devices({ family: 'miner', metric: 'power', order: 'asc', limit: 3 })).content[0].text)

  t.is(parsed.items.length, 3, 'limit applies after every batch has been read')
  t.alike(parsed.items.map((d) => d.deviceId), ['antminer-0', 'antminer-1', 'antminer-2'])
})

// The agent writes its tool calls as JSON by hand, and a small model quotes numbers as often as
// not. Rejecting "5" is correct and useless: the operator is told their data is unavailable
// because a digit arrived in quotes. Measured — it collapsed rank_devices from 98% to 45%.
test('a numeric argument arriving as a string is accepted', (t) => {
  const configs = captureConfigs(fakeClient())
  const listLimit = configs.list_devices.inputSchema.limit
  const rankLimit = configs.rank_devices.inputSchema.limit

  t.is(listLimit.parse('7'), 7, 'list_devices takes a quoted limit')
  t.is(rankLimit.parse('3'), 3, 'and so does rank_devices')
  t.is(rankLimit.parse(3), 3, 'a real number still works')

  const rejects = (fn) => {
    try {
      fn()
      return false
    } catch {
      return true
    }
  }
  t.ok(rejects(() => rankLimit.parse('99')), 'but the bound still applies')
  t.ok(rejects(() => rankLimit.parse('lots')), 'and nonsense is still nonsense')
})
