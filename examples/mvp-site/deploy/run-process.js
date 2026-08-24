'use strict'

// Single per-process entrypoint for every PM2-supervised role — mocks, kernel,
// workers, gateway, mcp. Which role to run comes from --role, set by start.js from
// config/site.deploy.json's pm2.roles (also runnable directly for debugging
// one role in isolation, e.g. `node deploy/run-process.js --role kernel`).

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { startGateway, onShutdown } = require('@tetherto/mdk-core')
const { createMcpServer } = require('@tetherto/mdk-mcp')
const {
  ROOT, GATEWAY_PORT, GATEWAY_HOST, AUTO_GENERATE_MCP, MCP_PORT, PLUGIN_DIRS, STATIC_ROOT_PATH, DISCOVERY,
  MCP_AGENT_TOOLS_PORT, MCP_PLUGIN_DIRS,
  loadSeedDevices, startMocks, startSatecMocks, startOceanMock,
  bootKernel, bootWorker, bootOceanWorker, bootSatecWorker
} = require('../backend/site')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const readKernelTopic = (root, mode) => {
  if (mode !== 'dht') return null
  const topicFile = path.join(root, '.dht-topic')
  if (!fs.existsSync(topicFile)) throw new Error('ERR_KERNEL_TOPIC_MISSING: start the Kernel first')
  return fs.readFileSync(topicFile, 'utf8').trim()
}

const KERNEL_KEY_WAIT_TIMEOUT_MS = 30000
const KERNEL_KEY_POLL_INTERVAL_MS = 250

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// gateway and mcp start as PM2 apps alongside (not after) the kernel role, so
// .kernel-key may not exist yet when they boot. Poll for it instead of
// crashing immediately — avoids a PM2 crash-restart loop racing the kernel's
// own boot time on every `npm run start`.
const waitForKernelKey = async (root) => {
  const kernelKeyFile = path.join(root, '.kernel-key')
  const deadline = Date.now() + KERNEL_KEY_WAIT_TIMEOUT_MS
  while (!fs.existsSync(kernelKeyFile)) {
    if (Date.now() >= deadline) throw new Error('ERR_KERNEL_KEY_MISSING: start the Kernel first')
    await sleep(KERNEL_KEY_POLL_INTERVAL_MS)
  }
  return fs.readFileSync(kernelKeyFile, 'utf8').trim()
}

// Boots one Whatsminer mock server per seed miner in config/devices.json — the
// real worker connects to these instead of hardware. The mock listeners keep
// the event loop alive; SIGINT/SIGTERM tear them down.
const runMocks = async () => {
  const { miners } = loadSeedDevices()
  const { ready, close } = startMocks(miners)
  await ready

  onShutdown(async () => close())

  console.log('MDK_READY mocks devices=%d', miners.length)
}

const runOceanMock = async () => {
  const { miners } = loadSeedDevices()
  const { ready, close } = startOceanMock(miners.length)
  await ready

  onShutdown(async () => close())

  console.log('MDK_READY mocks-ocean workers=%d', miners.length)
}

const runSatecMocks = async () => {
  const { miners, powermeters } = loadSeedDevices()
  const { ready, close } = startSatecMocks(powermeters, miners.length)
  await ready

  onShutdown(async () => close())

  console.log('MDK_READY mocks-satec devices=%d', powermeters.length)
}

// Boots the Kernel. --discovery local|dht (default from config/site.deploy.json).
// local: getKernel registers the worker by the RPC key it publishes to the
// shared dir. dht: Hyperswarm topic — this role owns the topic file (reads
// .dht-topic, else generates + writes it). Writes the Kernel's HRPC public key
// to .kernel-key for the gateway to connect.
const runKernel = async () => {
  const root = arg('--root', ROOT)
  const mode = arg('--discovery', DISCOVERY)
  fs.mkdirSync(root, { recursive: true })

  let topic = null
  if (mode === 'dht') {
    const topicFile = path.join(root, '.dht-topic')
    topic = fs.existsSync(topicFile) ? fs.readFileSync(topicFile, 'utf8').trim() : null
    if (!topic) {
      topic = crypto.randomBytes(32).toString('hex')
      fs.writeFileSync(topicFile, topic, 'utf8')
    }
  }

  const kernel = await bootKernel({ root, topic, mode })
  const kernelKey = kernel.getPublicKey().toString('hex')
  fs.writeFileSync(path.join(root, '.kernel-key'), kernelKey, 'utf8')

  // getKernel handles SIGINT/SIGTERM (drains kernel._cleanup, then kernel.stop()).
  console.log('MDK_READY kernel key=%s mode=%s%s', kernelKey, mode, topic ? ` topic=${topic}` : '')
}

// Boots the Whatsminer worker (no in-process Kernel handle). local (default):
// publish the RPC key to the shared dir. dht: read the Kernel's topic from
// .dht-topic and join it. Seed devices come from config/devices.json (miners).
const runWorker = async () => {
  const root = arg('--root', ROOT)
  const mode = arg('--discovery', DISCOVERY)
  const kernelTopic = readKernelTopic(root, mode)

  const { miners } = loadSeedDevices()
  const handle = await bootWorker({ kernelTopic, root, mode, devices: miners })
  const seeded = handle.services.provisioning.listDeviceIds().length

  // bootWorker (no kernel handle) binds SIGINT/SIGTERM to the runtime handle's stop.
  console.log('MDK_READY worker devices=%d', seeded)
}

const runOceanWorker = async () => {
  const root = arg('--root', ROOT)
  const mode = arg('--discovery', DISCOVERY)
  const kernelTopic = readKernelTopic(root, mode)

  await bootOceanWorker({ kernelTopic, root, mode })

  console.log('MDK_READY worker-ocean')
}

const runSatecWorker = async () => {
  const root = arg('--root', ROOT)
  const mode = arg('--discovery', DISCOVERY)
  const kernelTopic = readKernelTopic(root, mode)

  const { powermeters } = loadSeedDevices()
  const handle = await bootSatecWorker({ kernelTopic, root, mode, devices: powermeters })
  const seeded = handle.services.provisioning.listDeviceIds().length

  console.log('MDK_READY worker-satec devices=%d', seeded)
}

// Boots the gateway (HRPC mdkClient + site plugin + static UI), connecting to
// the Kernel by its .kernel-key public key (RPC-listener-only — no in-process
// Kernel handle). The site plugin's autoGenerateMcp flag makes the gateway
// also auto-start an in-process MCP server exposing that plugin's HTTP routes
// as tools (site_overview, site_history, site_miner_command, site_miner_pools) —
// no separate mcp-plugin.json or MCP process needed.
const runGateway = async () => {
  const root = arg('--root', ROOT)
  const port = Number(arg('--port', GATEWAY_PORT))

  const kernelKey = await waitForKernelKey(root)

  await startGateway({
    kernelKey,
    extraPluginDirs: PLUGIN_DIRS.map((dir) => ({ dir, autoGenerateMcp: AUTO_GENERATE_MCP })),
    port,
    mcp: { port: MCP_PORT },
    httpd: { h0: { host: GATEWAY_HOST } },
    root: path.join(root, 'gateway'),
    common: { staticRootPath: STATIC_ROOT_PATH }
  })

  // The site plugin's own mdk client (lib/client.js) dials the Kernel lazily
  // per-request, so gateway boot only needs the Kernel's public key (waited
  // for above), not the Kernel actually reachable yet — no depends_on/ordering
  // required between the two PM2 apps.
  // Standalone startGateway handles SIGINT/SIGTERM (hnd.stop()).
  console.log('MDK_READY gateway port=%d kernel=%s', port, kernelKey.slice(0, 16))
}

// Boots the standalone MCP server (Streamable HTTP) serving the hand-authored
// agent-contract tools (backend/mcp-plugins/site) — curated granularity and
// descriptions the auto-generated gateway tools don't provide. The Kernel's
// .kernel-key public key goes into the ambient plugin config — each tool
// plugin authors its own HRPC client from it (lib/client.js), so no client is
// built here. Tools come from MCP_PLUGIN_DIRS (mcp-plugin.json manifests).
const runMcp = async () => {
  const root = arg('--root', ROOT)
  const port = Number(arg('--port', MCP_AGENT_TOOLS_PORT))

  const kernelKey = await waitForKernelKey(root)

  await createMcpServer(root, port, { kernelKey }, MCP_PLUGIN_DIRS)

  // createMcpServer handles SIGINT/SIGTERM (stops the HTTP server).
  console.log('MDK_READY mcp port=%d kernel=%s', port, kernelKey.slice(0, 16))
}

const ROLES = {
  mocks: runMocks,
  'mocks-ocean': runOceanMock,
  'mocks-satec': runSatecMocks,
  kernel: runKernel,
  worker: runWorker,
  'worker-ocean': runOceanWorker,
  'worker-satec': runSatecWorker,
  gateway: runGateway,
  mcp: runMcp
}

const main = async () => {
  const role = arg('--role')
  const run = ROLES[role]
  if (!run) throw new Error(`ERR_UNKNOWN_ROLE: --role must be one of ${Object.keys(ROLES).join(', ')}`)
  await run()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
