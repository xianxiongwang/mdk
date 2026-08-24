'use strict'

const http = require('http')
const path = require('path')
const createLogger = require('debug')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { loadPlugin } = require('./lib/plugin-loader')
const { generateToolsFromGatewayPlugin } = require('./lib/from-http-plugin')

const AGENT_META_KEY = 'x-mdk-agent'

function _toolRegistrations (tools) {
  return tools.map((tool) => [tool.id, {
    description: tool.description,
    inputSchema: tool.schema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    ...(tool.agent ? { _meta: { [AGENT_META_KEY]: tool.agent } } : {})
  }, (args) => tool._handler(args)])
}

// Bare HTTP+MCP server over a fixed tool set — no plugin loading. Reusable by
// callers (e.g. the gateway) that already own their own ambient plugin context
// and just need tools exposed over MCP.
async function startMcpHttpServer (port, tools) {
  if (!port) throw new Error('ERR_INVALID_MCP_PORT')

  const registrations = _toolRegistrations(tools || [])

  const httpServer = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    const server = new McpServer({ name: 'mdk-mcp', version: '1.0.0' })
    for (const args of registrations) server.registerTool(...args)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (err) {
      console.error(err)
      if (!res.writableEnded) res.writeHead(500).end()
    }
  })

  await new Promise((resolve) => httpServer.listen(port, '127.0.0.1', resolve))

  return httpServer
}

const createMcpServer = async (root, port, config, pluginDirs) => {
  if (!root) throw new Error('ERR_INVALID_MCP_ROOT')
  if (!port) throw new Error('ERR_INVALID_MCP_PORT')

  // What a plugin sees as '@tetherto/mdk-mcp/plugin'. The plugin authors its
  // own kernel client from config.kernelKey/kernelBootstrap; the server no
  // longer owns one.
  const conf = Object.freeze({ ...(config || {}) })
  const tools = (pluginDirs || []).flatMap((dir) => loadPlugin(dir, Object.freeze({
    config: conf,
    logger: createLogger(`mdk:mcp:plugin:${path.basename(dir)}`)
  })).tools)

  const httpServer = await startMcpHttpServer(port, tools)

  const shutdown = () => {
    httpServer.close(() => process.exit(0))
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  return httpServer
}

module.exports = {
  createMcpServer,
  startMcpHttpServer,
  generateToolsFromGatewayPlugin
}
