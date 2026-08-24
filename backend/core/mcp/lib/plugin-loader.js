'use strict'

const path = require('path')
// Deep import: @tetherto/mdk-worker's index.js would pull the whole worker
// runtime (hyperswarm) into the MCP server for a loader that only needs
// fs/path/module.
const { createModuleContext } = require('@tetherto/mdk-worker/lib/module-context')

function _validateManifest (manifest, pluginDir) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`ERR_PLUGIN_MANIFEST_INVALID: ${pluginDir}: must be a JSON object`)
  }

  for (const field of ['name', 'version']) {
    if (typeof manifest[field] !== 'string' || !manifest[field]) {
      throw new Error(`ERR_PLUGIN_MANIFEST_INVALID: ${pluginDir}: missing required field "${field}"`)
    }
  }

  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    throw new Error(`ERR_PLUGIN_MANIFEST_INVALID: ${pluginDir}: "tools" must be a non-empty array`)
  }

  const seenIds = new Set()

  for (const tool of manifest.tools) {
    if (typeof tool.id !== 'string' || !tool.id) {
      throw new Error(`ERR_PLUGIN_MANIFEST_INVALID: ${pluginDir}: tool missing required field "id"`)
    }

    if (typeof tool.handler !== 'string' || !tool.handler) {
      throw new Error(`ERR_PLUGIN_MANIFEST_INVALID: ${pluginDir}: tool "${tool.id}" missing required field "handler"`)
    }

    if (typeof tool.description !== 'string' || !tool.description) {
      throw new Error(`ERR_PLUGIN_MANIFEST_INVALID: ${pluginDir}: tool "${tool.id}" missing required field "description"`)
    }

    for (const field of ['annotations', 'agent']) {
      const value = tool[field]
      if (value === undefined) continue
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`ERR_PLUGIN_MANIFEST_INVALID: ${pluginDir}: tool "${tool.id}" field "${field}" must be an object`)
      }
    }

    if (seenIds.has(tool.id)) {
      throw new Error(`ERR_PLUGIN_TOOL_DUPLICATE_ID: ${pluginDir}: duplicate tool id "${tool.id}"`)
    }
    seenIds.add(tool.id)
  }
}

function loadPlugin (pluginDir, context) {
  const manifestPath = path.join(pluginDir, 'mcp-plugin.json')

  let manifest
  try {
    manifest = require(manifestPath)
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error(`ERR_PLUGIN_MANIFEST_MISSING: ${pluginDir}`)
    }
    throw new Error(`ERR_PLUGIN_MANIFEST_INVALID: ${pluginDir}: ${err.message}`)
  }

  _validateManifest(manifest, pluginDir)

  // One private module registry per plugin: tool files and everything they
  // require in-package (their lib/client.js, say) load fresh for this plugin,
  // and '@tetherto/mdk-mcp/plugin' resolves to its own frozen context.
  const moduleContext = createModuleContext({
    dir: pluginDir,
    ambient: context ? { '@tetherto/mdk-mcp/plugin': context } : {},
    label: `[mdk-mcp-plugin:${manifest.name}]`
  })

  const tools = manifest.tools.map(tool => {
    const [handlerFile, namedExport] = tool.handler.split('#')
    const handlerPath = path.resolve(pluginDir, handlerFile)

    let mod
    try {
      mod = moduleContext.load(handlerPath)
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        throw new Error(`ERR_PLUGIN_HANDLER_NOT_FOUND: ${pluginDir}: tool "${tool.id}" handler "${tool.handler}"`)
      }
      throw new Error(`ERR_PLUGIN_HANDLER_NOT_FOUND: ${pluginDir}: tool "${tool.id}": ${err.message}`)
    }

    const resolved = namedExport ? mod[namedExport] : mod
    const handler = resolved && resolved.handler

    if (typeof handler !== 'function') {
      throw new Error(`ERR_PLUGIN_HANDLER_NOT_FUNCTION: ${pluginDir}: tool "${tool.id}" must export a "handler" function`)
    }

    return {
      id: tool.id,
      description: tool.description,
      schema: resolved.schema || {},
      annotations: tool.annotations,
      agent: tool.agent,
      _handler: handler
    }
  })

  return { manifest, tools }
}

module.exports = { loadPlugin }
