'use strict'

const test = require('brittle')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { createMcpServer } = require('../../server')

const FIXTURES_DIR = path.join(os.tmpdir(), 'mdk-mcp-server-test-' + Date.now())
let nextPort = 41730

function writeFixture (dir, files) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
}

async function connectClient (port) {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))
  await client.connect(transport)
  return client
}

test('createMcpServer - throws ERR_INVALID_MCP_ROOT when root missing', async (t) => {
  try {
    await createMcpServer(null, nextPort++, {}, [])
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.startsWith('ERR_INVALID_MCP_ROOT'), 'should throw ERR_INVALID_MCP_ROOT')
  }
  t.pass()
})

test('createMcpServer - throws ERR_INVALID_MCP_PORT when port missing', async (t) => {
  try {
    await createMcpServer('/tmp/mdk-mcp-test-root', null, {}, [])
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.startsWith('ERR_INVALID_MCP_PORT'), 'should throw ERR_INVALID_MCP_PORT')
  }
  t.pass()
})

test('createMcpServer - serves tools from a single plugin dir', async (t) => {
  const dir = path.join(FIXTURES_DIR, 'single-plugin')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/mcp-plugin-echo',
      version: '1.0.0',
      tools: [
        { id: 'echo', handler: './tools/echo.js', description: 'echoes the ambient config' }
      ]
    },
    'tools/echo.js': [
      '\'use strict\'',
      'const { config } = require(\'@tetherto/mdk-mcp/plugin\')',
      'module.exports = {',
      '  schema: {},',
      '  handler: async (args) => ({',
      '    content: [{ type: \'text\', text: JSON.stringify({ kernelKey: config.kernelKey, frozen: Object.isFrozen(config) }) }]',
      '  })',
      '}'
    ].join('\n')
  })

  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, { kernelKey: 'the-key' }, [dir])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const mcpClient = await connectClient(port)
  t.teardown(() => mcpClient.close())

  const { tools } = await mcpClient.listTools()
  t.is(tools.length, 1, 'should list one tool')
  t.is(tools[0].name, 'echo', 'should have the tool id as name')
  t.is(tools[0].description, 'echoes the ambient config', 'should have the tool description')

  const result = await mcpClient.callTool({ name: 'echo', arguments: {} })
  const payload = JSON.parse(result.content[0].text)
  t.is(payload.kernelKey, 'the-key', 'handler should read the config passed to createMcpServer')
  t.is(payload.frozen, true, 'config should arrive frozen')
  t.pass()
})

test('createMcpServer - merges tools from multiple plugin dirs', async (t) => {
  const dirA = path.join(FIXTURES_DIR, 'multi-a')
  const dirB = path.join(FIXTURES_DIR, 'multi-b')
  writeFixture(dirA, {
    'mcp-plugin.json': {
      name: '@test/mcp-plugin-a',
      version: '1.0.0',
      tools: [{ id: 'tool_a', handler: './tools/a.js', description: 'a' }]
    },
    'tools/a.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({ content: [{ type: \'text\', text: \'a\' }] }) }'
  })
  writeFixture(dirB, {
    'mcp-plugin.json': {
      name: '@test/mcp-plugin-b',
      version: '1.0.0',
      tools: [{ id: 'tool_b', handler: './tools/b.js', description: 'b' }]
    },
    'tools/b.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({ content: [{ type: \'text\', text: \'b\' }] }) }'
  })

  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [dirA, dirB])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const mcpClient = await connectClient(port)
  t.teardown(() => mcpClient.close())

  const { tools } = await mcpClient.listTools()
  t.alike(tools.map((tool) => tool.name).sort(), ['tool_a', 'tool_b'], 'should serve tools from both plugin dirs')
  t.pass()
})

test('createMcpServer - starts with no tools capability when pluginDirs is empty', async (t) => {
  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const mcpClient = await connectClient(port)
  t.teardown(() => mcpClient.close())

  await mcpClient.ping()
  t.alike(mcpClient.getServerCapabilities(), {}, 'should advertise no capabilities with zero tools registered')
  t.pass()
})

test('createMcpServer - non-POST requests respond 404', async (t) => {
  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' })
  t.is(res.status, 404, 'GET /mcp should respond 404')
  t.pass()
})

test('createMcpServer - unknown path responds 404', async (t) => {
  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const res = await fetch(`http://127.0.0.1:${port}/not-mcp`, { method: 'POST' })
  t.is(res.status, 404, 'POST to an unknown path should respond 404')
  t.pass()
})

test('createMcpServer - tool schema is enforced', async (t) => {
  // Uses a committed fixture (tests/fixtures/schema-enforced-plugin) rather than a
  // dynamically-written tmpdir file, since the handler needs to `require('zod')` —
  // a tmpdir fixture has no node_modules to resolve third-party deps from.
  const dir = path.join(__dirname, '..', 'fixtures', 'schema-enforced-plugin')

  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [dir])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const mcpClient = await connectClient(port)
  t.teardown(() => mcpClient.close())

  const result = await mcpClient.callTool({ name: 'needs_arg', arguments: { name: 'world' } })
  t.is(result.content[0].text, 'hello world', 'should validate and pass through the argument')
  t.pass()
})

test('createMcpServer - propagates a thrown handler error as a tool error result', async (t) => {
  const dir = path.join(FIXTURES_DIR, 'throwing-tool')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/mcp-plugin-throwing',
      version: '1.0.0',
      tools: [{ id: 'boom', handler: './tools/boom.js', description: 'always throws' }]
    },
    'tools/boom.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => { throw new Error(\'ERR_BOOM\') } }'
  })

  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [dir])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const mcpClient = await connectClient(port)
  t.teardown(() => mcpClient.close())

  const result = await mcpClient.callTool({ name: 'boom', arguments: {} })
  t.ok(result.isError, 'should mark the result as an error')
  t.ok(result.content[0].text.includes('ERR_BOOM'), 'should surface the thrown error message')
  t.pass()
})

test('createMcpServer - transport failure is logged and responds 500', async (t) => {
  const port = nextPort++

  const originalConnect = McpServer.prototype.connect
  McpServer.prototype.connect = async () => { throw new Error('ERR_TRANSPORT_BOOM') }
  t.teardown(() => { McpServer.prototype.connect = originalConnect })

  const originalConsoleError = console.error
  let loggedErr = null
  console.error = (err) => { loggedErr = err }
  t.teardown(() => { console.error = originalConsoleError })

  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  })

  t.is(res.status, 500, 'should respond 500 when the transport throws')
  t.ok(loggedErr && loggedErr.message === 'ERR_TRANSPORT_BOOM', 'should log the thrown error')
  t.pass()
})

test('createMcpServer - SIGINT/SIGTERM handler closes the http server, then exits', async (t) => {
  const port = nextPort++

  const originalOnce = process.once
  const handlers = {}
  process.once = (event, handler) => {
    if (event === 'SIGINT' || event === 'SIGTERM') handlers[event] = handler
    return originalOnce.call(process, event, handler)
  }

  let httpServer
  try {
    httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [])
  } finally {
    process.once = originalOnce
  }

  t.is(typeof handlers.SIGINT, 'function', 'should register a SIGINT handler')
  t.is(typeof handlers.SIGTERM, 'function', 'should register a SIGTERM handler')

  const originalExit = process.exit
  let exitCode = null
  process.exit = (code) => { exitCode = code }
  t.teardown(() => { process.exit = originalExit })

  const closed = new Promise((resolve) => httpServer.once('close', resolve))
  handlers.SIGINT()
  await closed

  t.is(exitCode, 0, 'shutdown should exit 0 once the http server has closed')
  t.pass()
})

test('createMcpServer - agent metadata reaches the client under _meta', async (t) => {
  const dir = path.join(FIXTURES_DIR, 'agent-meta')
  const agent = {
    enabled: true,
    answers: 'how many devices match a family and state',
    useWhen: ['how many miners are online', 'number of offline containers'],
    notFor: ['listing them'],
    returns: 'a count with a one-line summary',
    minCapability: 'small'
  }
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/mcp-plugin-agent-meta',
      version: '1.0.0',
      tools: [{
        id: 'count_devices',
        handler: './tools/count.js',
        description: 'counts devices',
        annotations: { readOnlyHint: true },
        agent
      }]
    },
    'tools/count.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({ content: [{ type: \'text\', text: \'1\' }] }) }'
  })

  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [dir])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const mcpClient = await connectClient(port)
  t.teardown(() => mcpClient.close())

  const { tools } = await mcpClient.listTools()
  t.alike(tools[0]._meta['x-mdk-agent'], agent, 'the whole agent block should survive the round trip')
  t.is(tools[0].annotations.readOnlyHint, true, 'declared MCP hints should survive too')
  t.pass()
})

test('createMcpServer - a tool without agent metadata is unchanged', async (t) => {
  const dir = path.join(FIXTURES_DIR, 'no-agent-meta')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/mcp-plugin-plain',
      version: '1.0.0',
      tools: [{ id: 'plain', handler: './tools/plain.js', description: 'no metadata' }]
    },
    'tools/plain.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({ content: [{ type: \'text\', text: \'ok\' }] }) }'
  })

  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [dir])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const mcpClient = await connectClient(port)
  t.teardown(() => mcpClient.close())

  const { tools } = await mcpClient.listTools()
  t.is(tools[0].name, 'plain', 'should still serve the tool')
  t.is(tools[0]._meta, undefined, 'should not add an empty _meta')
  t.is(tools[0].annotations, undefined, 'should not add empty annotations')

  const result = await mcpClient.callTool({ name: 'plain', arguments: {} })
  t.is(result.content[0].text, 'ok', 'should still dispatch to the handler')
  t.pass()
})

test('createMcpServer - metadata put in annotations does NOT reach the client', async (t) => {
  // Why the contract lives in _meta. If this ever stops holding, annotations becomes viable too.
  const dir = path.join(FIXTURES_DIR, 'meta-in-annotations')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/mcp-plugin-wrong-carrier',
      version: '1.0.0',
      tools: [{
        id: 'wrong_carrier',
        handler: './tools/w.js',
        description: 'declares its contract in the wrong field',
        annotations: { readOnlyHint: true, 'x-mdk-agent': { enabled: true } }
      }]
    },
    'tools/w.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({ content: [{ type: \'text\', text: \'ok\' }] }) }'
  })

  const port = nextPort++
  const httpServer = await createMcpServer(path.join(FIXTURES_DIR, 'root'), port, {}, [dir])
  t.teardown(() => new Promise((resolve) => httpServer.close(resolve)))

  const mcpClient = await connectClient(port)
  t.teardown(() => mcpClient.close())

  const { tools } = await mcpClient.listTools()
  t.is(tools[0].annotations['x-mdk-agent'], undefined, 'the SDK strips it — this is the bug _meta avoids')
  t.is(tools[0].annotations.readOnlyHint, true, 'while the declared hint beside it survives')
  t.pass()
})
