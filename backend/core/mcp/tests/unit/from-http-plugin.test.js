'use strict'

const test = require('brittle')
const { z } = require('zod')
const { generateToolsFromGatewayPlugin } = require('../../lib/from-http-plugin')

function makePlugin (routes, manifest) {
  return { manifest: manifest || { description: 'fallback plugin description' }, routes }
}

test('generateToolsFromGatewayPlugin - sanitizes route id into a valid tool id', (t) => {
  const plugin = makePlugin([
    { id: 'GET /devices/:id', description: 'gets a device', http: {}, _handler: async () => ({}) }
  ])

  const [tool] = generateToolsFromGatewayPlugin(plugin)
  t.is(tool.id, 'GET_devices_id', 'should replace non-alphanumeric runs with underscores')
  t.pass()
})

test('generateToolsFromGatewayPlugin - uses route description, falling back to plugin description', (t) => {
  const plugin = makePlugin([
    { id: 'with-desc', description: 'route-level description', http: {}, _handler: async () => ({}) },
    { id: 'without-desc', http: {}, _handler: async () => ({}) }
  ])

  const [withDesc, withoutDesc] = generateToolsFromGatewayPlugin(plugin)
  t.is(withDesc.description, 'route-level description', 'should prefer the route description')
  t.is(withoutDesc.description, 'fallback plugin description', 'should fall back to the plugin description')
  t.pass()
})

test('generateToolsFromGatewayPlugin - maps safety to MCP annotations', (t) => {
  const plugin = makePlugin([
    { id: 'ro', description: 'x', http: {}, safety: 'read-only', _handler: async () => ({}) },
    { id: 'w', description: 'x', http: {}, safety: 'write', _handler: async () => ({}) },
    { id: 'none', description: 'x', http: {}, _handler: async () => ({}) }
  ])

  const [ro, w, none] = generateToolsFromGatewayPlugin(plugin)
  t.alike(ro.annotations, { readOnlyHint: true }, 'read-only safety should set readOnlyHint')
  t.alike(w.annotations, { destructiveHint: true }, 'write safety should set destructiveHint')
  t.is(none.annotations, undefined, 'unrecognized/missing safety should leave annotations undefined')
  t.pass()
})

test('generateToolsFromGatewayPlugin - builds a zod shape from path, query and header parameters', (t) => {
  const plugin = makePlugin([{
    id: 'params',
    description: 'x',
    http: {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' }, description: 'api key' },
        { name: 'ignored', in: 'cookie', schema: { type: 'string' } }
      ]
    },
    _handler: async () => ({})
  }])

  const [tool] = generateToolsFromGatewayPlugin(plugin)
  const schema = z.object(tool.schema)

  t.ok(schema.shape.id, 'should include the required path param')
  t.ok(schema.shape.limit, 'should include the optional query param')
  t.ok(schema.shape['x-api-key'], 'should include the required header param')
  t.is(schema.shape.ignored, undefined, 'should ignore parameters in unsupported "in" locations')

  t.ok(schema.safeParse({ id: 'abc', 'x-api-key': 'k' }).success, 'required-only args should validate')
  t.ok(!schema.safeParse({ 'x-api-key': 'k' }).success, 'missing required path param should fail')
  t.ok(!schema.safeParse({ id: 'abc', limit: 0, 'x-api-key': 'k' }).success, 'limit below minimum should fail')
  t.ok(!schema.safeParse({ id: 'abc', limit: 101, 'x-api-key': 'k' }).success, 'limit above maximum should fail')
  t.pass()
})

test('generateToolsFromGatewayPlugin - merges requestBody JSON schema properties into the shape', (t) => {
  const plugin = makePlugin([{
    id: 'body',
    description: 'x',
    http: {
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', description: 'the name' },
                active: { type: 'boolean' }
              }
            }
          }
        }
      }
    },
    _handler: async () => ({})
  }])

  const [tool] = generateToolsFromGatewayPlugin(plugin)
  const schema = z.object(tool.schema)

  t.ok(schema.safeParse({ name: 'a' }).success, 'required body field alone should validate')
  t.ok(!schema.safeParse({ active: true }).success, 'missing required body field should fail')
  t.ok(schema.safeParse({ name: 'a', active: true }).success, 'optional body field should be accepted')
  t.pass()
})

test('generateToolsFromGatewayPlugin - zod conversion covers enum, array and nested object schemas', (t) => {
  const plugin = makePlugin([{
    id: 'types',
    description: 'x',
    http: {
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status', 'tags', 'meta', 'untyped'],
              properties: {
                status: { type: 'string', enum: ['on', 'off'] },
                tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
                meta: {
                  type: 'object',
                  required: ['owner'],
                  properties: { owner: { type: 'string' } }
                },
                untyped: {}
              }
            }
          }
        }
      }
    },
    _handler: async () => ({})
  }])

  const [tool] = generateToolsFromGatewayPlugin(plugin)
  const schema = z.object(tool.schema)

  t.ok(schema.safeParse({ status: 'on', tags: ['a'], meta: { owner: 'me' }, untyped: 42 }).success, 'valid combination should pass')
  t.ok(!schema.safeParse({ status: 'sideways', tags: ['a'], meta: { owner: 'me' }, untyped: 1 }).success, 'value outside enum should fail')
  t.ok(!schema.safeParse({ status: 'on', tags: [], meta: { owner: 'me' }, untyped: 1 }).success, 'array below minItems should fail')
  t.ok(!schema.safeParse({ status: 'on', tags: ['a', 'b', 'c', 'd'], meta: { owner: 'me' }, untyped: 1 }).success, 'array above maxItems should fail')
  t.ok(!schema.safeParse({ status: 'on', tags: ['a'], meta: {}, untyped: 1 }).success, 'missing required nested field should fail')
  t.ok(schema.safeParse({ status: 'on', tags: ['a'], meta: { owner: 'me' }, untyped: 'anything goes' }).success, 'untyped property should accept any value')
  t.pass()
})

test('generateToolsFromGatewayPlugin - array items default to z.any() when unspecified', (t) => {
  const plugin = makePlugin([{
    id: 'loose-array',
    description: 'x',
    http: {
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['items'],
              properties: { items: { type: 'array' } }
            }
          }
        }
      }
    },
    _handler: async () => ({})
  }])

  const [tool] = generateToolsFromGatewayPlugin(plugin)
  const schema = z.object(tool.schema)

  t.ok(schema.safeParse({ items: [1, 'two', { three: true }] }).success, 'mixed-type array items should be accepted')
  t.pass()
})

test('generateToolsFromGatewayPlugin - handler reassembles flat args into params/query/headers/body and JSON-stringifies the result', async (t) => {
  let received = null
  const plugin = makePlugin([{
    id: 'echo-route',
    description: 'x',
    http: {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'verbose', in: 'query', schema: { type: 'boolean' } },
        { name: 'x-trace', in: 'header', schema: { type: 'string' } }
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { note: { type: 'string' } } }
          }
        }
      }
    },
    _handler: async (pluginReq) => {
      received = pluginReq
      return { ok: true }
    }
  }])

  const [tool] = generateToolsFromGatewayPlugin(plugin)
  const result = await tool._handler({ id: 'abc', verbose: true, 'x-trace': 't1', note: 'hello' })

  t.alike(received.params, { id: 'abc' }, 'path params should land in params')
  t.alike(received.query, { verbose: true }, 'query params should land in query')
  t.alike(received.headers, { 'x-trace': 't1' }, 'header params should land in headers')
  t.alike(received.body, { note: 'hello' }, 'remaining keys should land in body')

  t.is(result.content[0].type, 'text', 'result should be wrapped as text content')
  t.alike(JSON.parse(result.content[0].text), { ok: true }, 'result should be the JSON-stringified handler return value')
  t.pass()
})

test('generateToolsFromGatewayPlugin - handler defaults args to an empty object when called with none', async (t) => {
  let received = null
  const plugin = makePlugin([{
    id: 'no-args-route',
    description: 'x',
    http: {},
    _handler: async (pluginReq) => {
      received = pluginReq
      return {}
    }
  }])

  const [tool] = generateToolsFromGatewayPlugin(plugin)
  await tool._handler()

  t.alike(received.params, {}, 'params should default to empty')
  t.alike(received.query, {}, 'query should default to empty')
  t.alike(received.headers, {}, 'headers should default to empty')
  t.alike(received.body, {}, 'body should default to empty')
  t.pass()
})
