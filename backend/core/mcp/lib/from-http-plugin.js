'use strict'

const { z } = require('zod')

function _zodFromJsonSchema (schema = {}) {
  let zodType

  switch (schema.type) {
    case 'string':
      zodType = Array.isArray(schema.enum) ? z.enum(schema.enum) : z.string()
      break
    case 'integer':
    case 'number': {
      let num = z.number()
      if (schema.minimum !== undefined) num = num.min(schema.minimum)
      if (schema.maximum !== undefined) num = num.max(schema.maximum)
      zodType = num
      break
    }
    case 'boolean':
      zodType = z.boolean()
      break
    case 'array': {
      let arr = z.array(schema.items ? _zodFromJsonSchema(schema.items) : z.any())
      if (schema.maxItems !== undefined) arr = arr.max(schema.maxItems)
      if (schema.minItems !== undefined) arr = arr.min(schema.minItems)
      zodType = arr
      break
    }
    case 'object':
      zodType = z.object(_objectShape(schema))
      break
    default:
      zodType = z.any()
  }

  return schema.description ? zodType.describe(schema.description) : zodType
}

// Builds a flat ZodRawShape from a JSON-schema object (as used in OpenAPI-style
// requestBody schemas): { properties: {...}, required: [...] }.
function _objectShape (schema = {}) {
  const shape = {}
  const required = new Set(schema.required || [])

  for (const [key, propSchema] of Object.entries(schema.properties || {})) {
    const zodType = _zodFromJsonSchema(propSchema)
    shape[key] = required.has(key) ? zodType : zodType.optional()
  }

  return shape
}

// Merges path/query/header parameters and the requestBody's top-level
// properties into one flat ZodRawShape (an MCP tool takes a single args
// object), tracking which keys belong to which group so the auto-generated
// handler can reassemble the gateway route's { params, query, headers, body }
// request shape from the flat args MCP hands it.
function _toolShapeFromRoute (route) {
  const shape = {}
  const groups = { path: new Set(), query: new Set(), header: new Set() }

  for (const param of route.http?.parameters || []) {
    const target = groups[param.in]
    if (!target) continue

    target.add(param.name)
    let zodType = _zodFromJsonSchema(param.schema || {})
    if (param.description) zodType = zodType.describe(param.description)
    shape[param.name] = param.required ? zodType : zodType.optional()
  }

  const bodySchema = route.http?.requestBody?.content?.['application/json']?.schema
  if (bodySchema) Object.assign(shape, _objectShape(bodySchema))

  return { shape, ...groups }
}

function _sanitizeId (id) {
  return id.replace(/[^a-zA-Z0-9]+/g, '_')
}

function _annotationsFromSafety (safety) {
  if (safety === 'read-only') return { readOnlyHint: true }
  if (safety === 'write') return { destructiveHint: true }
  return undefined
}

// Converts a loaded gateway plugin's HTTP routes (backend/core/gateway/workers/lib/plugin-loader.js
// output: { manifest, routes }, each route already bound to its handler + services
// via registerPlugin) into MCP-tool definitions shaped like backend/core/mcp/lib/plugin-loader.js's
// output, so they can be fed straight into startMcpHttpServer.
function generateToolsFromGatewayPlugin (plugin) {
  return plugin.routes.map((route) => {
    const { shape, path, query, header } = _toolShapeFromRoute(route)

    const _handler = async (args) => {
      const pluginReq = { params: {}, query: {}, headers: {}, body: {}, _info: {} }
      for (const [key, value] of Object.entries(args || {})) {
        if (path.has(key)) pluginReq.params[key] = value
        else if (query.has(key)) pluginReq.query[key] = value
        else if (header.has(key)) pluginReq.headers[key] = value
        else pluginReq.body[key] = value
      }

      const result = await route._handler(pluginReq)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }

    return {
      id: _sanitizeId(route.id),
      description: route.description || plugin.manifest.description,
      schema: shape,
      annotations: _annotationsFromSafety(route.safety),
      _handler
    }
  })
}

module.exports = { generateToolsFromGatewayPlugin }
