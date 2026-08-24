'use strict'

// Builds what a plugin sees as require('@tetherto/mdk-gateway/plugin') — the
// contract between a plugin and the gateway. There are no phases, no worker
// internals and no gateway lifecycle to learn.
//
// The full surface:
//   gw.config           gateway conf ⊕ the plugin's own config block
//                       (spec.gateway.plugins[].config wins key-by-key)
//
// Everything else a plugin needs it owns: kernel and worker data — live or
// historical — go through the plugin's own mdk client, built from
// config.kernelKey/kernelBootstrap (see the telemetry plugin's lib/client.js).

function buildPluginContext (wrk, pluginDir, pluginConf) {
  const kernelKey = Buffer.isBuffer(wrk.ctx.kernelKey) ? wrk.ctx.kernelKey.toString('hex') : wrk.ctx.kernelKey

  const context = Object.freeze({
    // The plugin's own config block (spec.gateway.plugins[].config) wins over
    // gateway-wide conf, so a plugin's settings live with the plugin.
    config: Object.freeze({
      kernelKey: kernelKey || null,
      kernelBootstrap: wrk.ctx.kernelBootstrap || null,
      ...wrk.conf,
      ...pluginConf
    })
  })

  return { context }
}

module.exports = { buildPluginContext }
