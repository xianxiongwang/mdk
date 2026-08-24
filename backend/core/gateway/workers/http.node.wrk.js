'use strict'

const path = require('path')
const { STATUS_CODES } = require('http')
const async = require('async')
const TetherWrkBase = require('@tetherto/tether-wrk-base/workers/base.wrk.tether')
const createLogger = require('debug')
const debug = createLogger('store:aggr')
const { loadPlugin } = require('./lib/plugin-loader')
const { buildFastifyRoutes } = require('./lib/plugin-adapter')
const { buildPluginContext } = require('./lib/plugin-gateway')
const { startMcpHttpServer, generateToolsFromGatewayPlugin } = require('@tetherto/mdk-mcp')

const DEFAULT_MCP_PORT_OFFSET = 100

const MDK_PLUGINS_ROOT = path.dirname(require.resolve('@tetherto/mdk-plugins/package.json'))

class WrkServerHttp extends TetherWrkBase {
  constructor (conf, ctx) {
    super(conf, ctx)

    if (!ctx.port) {
      throw new Error('ERR_HTTP_PORT_INVALID')
    }

    this.storeDir = 'http'
    this.prefix = `${this.wtype}-${ctx.port}`
    this.queuedRequests = new Map()

    this.init()
    this.start()
  }

  init () {
    super.init()

    this.setInitFacs([
      ['fac', '@bitfinex/bfx-facs-lru', '10s', '10s', { max: 10000, maxAge: 10000 }],
      ['fac', '@bitfinex/bfx-facs-lru', '15s', '15s', { max: 10000, maxAge: 15000 }],
      ['fac', '@bitfinex/bfx-facs-lru', '30s', '30s', { max: 10000, maxAge: 30000 }],
      ['fac', '@bitfinex/bfx-facs-lru', '1m', '1m', { max: 10000, maxAge: 60000 }],
      ['fac', '@bitfinex/bfx-facs-lru', '15m', '15m', { max: 10000, maxAge: 60000 * 15 }],
      ['fac', '@tetherto/svc-facs-httpd', 'h0', 'h0', {
        staticRootPath: this.conf.staticRootPath,
        staticOn404File: 'index.html',
        port: this.ctx.port,
        logger: true,
        addDefaultRoutes: true,
        trustProxy: true
      }, 0]
    ])

    this._plugins = []
    this._mcpTools = []

    this.registerPlugin(path.join(MDK_PLUGINS_ROOT, 'telemetry'))
    this.registerPlugin(path.join(MDK_PLUGINS_ROOT, 'site-hashrate'))
    this.registerPlugin(path.join(MDK_PLUGINS_ROOT, 'site-monitor'))

    // Entries are a plugin dir, or { dir, config, autoGenerateMcp } when the
    // stack spec carries per-plugin config (spec.gateway.plugins[].config).
    for (const entry of this.ctx.extraPluginDirs || []) {
      if (typeof entry === 'string') this.registerPlugin(entry)
      else this.registerPlugin(entry.dir, entry.config, entry.autoGenerateMcp)
    }
  }

  // When autoGenerateMcp is true, the plugin's HTTP routes are converted into
  // MCP tools (params/body -> Zod schema, bound route handler reused as-is)
  // and queued for the in-process MCP server started in _start().
  registerPlugin (pluginDir, pluginConf, autoGenerateMcp) {
    // buildPluginContext constructs everything a plugin sees as
    // '@tetherto/mdk-gateway/plugin' — plugins never touch the worker.
    const { context } = buildPluginContext(this, pluginDir, pluginConf)
    const plugin = loadPlugin(pluginDir, context)
    this._plugins.push(plugin)
    debug('registered plugin %s (%d routes)', plugin.manifest.name, plugin.routes.length)

    if (autoGenerateMcp) {
      const tools = generateToolsFromGatewayPlugin(plugin)
      this._mcpTools.push(...tools)
      debug('auto-generated %d MCP tool(s) from plugin %s', tools.length, plugin.manifest.name)
    }
  }

  debugGeneric (msg) {
    debug(`[HTTP/${this.ctx.shard}]`, ...arguments)
  }

  _start (cb) {
    async.series([
      next => { super._start(next) },
      async () => {
        await this.net_r0.startRpcServer()

        const httpd = this.httpd_h0

        this.ctx.additionalRoutes?.forEach(r => {
          httpd.addRoute(r)
        })

        for (const plugin of this._plugins) {
          buildFastifyRoutes(plugin, this).forEach(r => {
            httpd.addRoute(r)
          })
        }

        httpd.addHook('onError', async (request, reply, error) => {
          const isSafe = error.message && error.message.startsWith('ERR_')
          const message = isSafe ? error.message : 'Bad Request'
          const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 ? error.statusCode : 400

          if (!isSafe) {
            debug('onError handler:', error.message)
          }

          return reply.status(status).send({
            statusCode: status,
            error: STATUS_CODES[status] || 'Bad Request',
            message
          })
        })

        await httpd.startServer()

        // rpc client key to be allowed through destination server firewall
        this.status.rpcClientKey = this.net_r0.dht.defaultKeyPair.publicKey.toString('hex')
        this.saveStatus()

        if (this._mcpTools.length) {
          const mcpPort = this.ctx.mcp?.port || (this.ctx.port + DEFAULT_MCP_PORT_OFFSET)
          this._mcpServer = await startMcpHttpServer(mcpPort, this._mcpTools)
          debug('MCP server auto-started on port %d (%d tool(s))', mcpPort, this._mcpTools.length)
        }
      }
    ], cb)
  }

  _stop (cb) {
    if (!this._mcpServer) return super._stop(cb)
    this._mcpServer.close(() => super._stop(cb))
  }
}

module.exports = WrkServerHttp
