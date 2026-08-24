'use strict'

const test = require('brittle')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { loadPlugin } = require('../../lib/plugin-loader')

const FIXTURES_DIR = path.join(os.tmpdir(), 'mdk-mcp-plugin-loader-test-' + Date.now())

function writeFixture (dir, files) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
}

test('loadPlugin - loads valid plugin', (t) => {
  const dir = path.join(FIXTURES_DIR, 'valid')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/mdk-plugin-valid',
      version: '1.0.0',
      description: 'test plugin',
      tools: [
        { id: 'test.hello', handler: './tools/hello.js', description: 'says hello' }
      ]
    },
    'tools/hello.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({ ok: true }) }'
  })

  const plugin = loadPlugin(dir)
  t.is(plugin.manifest.name, '@test/mdk-plugin-valid', 'should have manifest name')
  t.is(plugin.tools.length, 1, 'should have one tool')
  t.is(plugin.tools[0].id, 'test.hello', 'should have tool id')
  t.is(plugin.tools[0].description, 'says hello', 'should have tool description')
  t.alike(plugin.tools[0].schema, {}, 'should have loaded schema')
  t.is(typeof plugin.tools[0]._handler, 'function', 'should have loaded handler')
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_MISSING when no manifest', (t) => {
  const dir = path.join(FIXTURES_DIR, 'no-manifest')
  fs.mkdirSync(dir, { recursive: true })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.startsWith('ERR_PLUGIN_MANIFEST_MISSING'), 'should throw ERR_PLUGIN_MANIFEST_MISSING')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when name missing', (t) => {
  const dir = path.join(FIXTURES_DIR, 'invalid-no-name')
  writeFixture(dir, {
    'mcp-plugin.json': {
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/x.js', description: 'x' }]
    }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
    t.ok(err.message.includes('"name"'), 'should mention missing field')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when version missing', (t) => {
  const dir = path.join(FIXTURES_DIR, 'invalid-no-version')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      tools: [{ id: 'x', handler: './tools/x.js', description: 'x' }]
    }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
    t.ok(err.message.includes('"version"'), 'should mention missing field')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when tools empty', (t) => {
  const dir = path.join(FIXTURES_DIR, 'invalid-empty-tools')
  writeFixture(dir, {
    'mcp-plugin.json': { name: '@test/p', version: '1.0.0', tools: [] }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
    t.ok(err.message.includes('"tools"'), 'should mention tools')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when tools missing entirely', (t) => {
  const dir = path.join(FIXTURES_DIR, 'invalid-no-tools')
  writeFixture(dir, {
    'mcp-plugin.json': { name: '@test/p', version: '1.0.0' }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
    t.ok(err.message.includes('"tools"'), 'should mention tools')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when tool missing id', (t) => {
  const dir = path.join(FIXTURES_DIR, 'invalid-tool-no-id')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ handler: './tools/x.js', description: 'x' }]
    }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
    t.ok(err.message.includes('"id"'), 'should mention missing id')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when tool missing handler', (t) => {
  const dir = path.join(FIXTURES_DIR, 'invalid-tool-no-handler')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', description: 'x' }]
    }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
    t.ok(err.message.includes('"handler"'), 'should mention missing handler')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when tool missing description', (t) => {
  const dir = path.join(FIXTURES_DIR, 'invalid-tool-no-description')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/x.js' }]
    }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
    t.ok(err.message.includes('"description"'), 'should mention missing description')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_TOOL_DUPLICATE_ID', (t) => {
  const dir = path.join(FIXTURES_DIR, 'dup-id')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [
        { id: 'same.id', handler: './tools/a.js', description: 'a' },
        { id: 'same.id', handler: './tools/b.js', description: 'b' }
      ]
    }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.startsWith('ERR_PLUGIN_TOOL_DUPLICATE_ID'), 'should throw ERR_PLUGIN_TOOL_DUPLICATE_ID')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_HANDLER_NOT_FOUND when file missing', (t) => {
  const dir = path.join(FIXTURES_DIR, 'missing-handler')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/doesnotexist.js', description: 'x' }]
    }
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.startsWith('ERR_PLUGIN_HANDLER_NOT_FOUND'), 'should throw ERR_PLUGIN_HANDLER_NOT_FOUND')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_HANDLER_NOT_FUNCTION when handler is not a function', (t) => {
  const dir = path.join(FIXTURES_DIR, 'not-a-fn')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/notfn.js', description: 'x' }]
    },
    'tools/notfn.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: \'not a function\' }'
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.startsWith('ERR_PLUGIN_HANDLER_NOT_FUNCTION'), 'should throw ERR_PLUGIN_HANDLER_NOT_FUNCTION')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_HANDLER_NOT_FUNCTION when module exports nothing usable', (t) => {
  const dir = path.join(FIXTURES_DIR, 'no-handler-export')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/empty.js', description: 'x' }]
    },
    'tools/empty.js': '\'use strict\'\nmodule.exports = {}'
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.startsWith('ERR_PLUGIN_HANDLER_NOT_FUNCTION'), 'should throw ERR_PLUGIN_HANDLER_NOT_FUNCTION')
  }
  t.pass()
})

test('loadPlugin - supports handler#namedExport syntax', (t) => {
  const dir = path.join(FIXTURES_DIR, 'named-export')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/multi.js#second', description: 'x' }]
    },
    'tools/multi.js': [
      '\'use strict\'',
      'module.exports = {',
      '  first: { schema: {}, handler: async () => ({ which: \'first\' }) },',
      '  second: { schema: {}, handler: async () => ({ which: \'second\' }) }',
      '}'
    ].join('\n')
  })

  const plugin = loadPlugin(dir)
  t.is(plugin.tools.length, 1, 'should have one tool')
  t.pass()
})

test('loadPlugin - defaults schema to {} when handler module omits it', (t) => {
  const dir = path.join(FIXTURES_DIR, 'no-schema')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/noschema.js', description: 'x' }]
    },
    'tools/noschema.js': '\'use strict\'\nmodule.exports = { handler: async () => ({}) }'
  })

  const plugin = loadPlugin(dir)
  t.alike(plugin.tools[0].schema, {}, 'should default schema to {}')
  t.pass()
})

test('loadPlugin - loads multiple tools from one manifest', (t) => {
  const dir = path.join(FIXTURES_DIR, 'multi-tool')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [
        { id: 'tool.a', handler: './tools/a.js', description: 'a' },
        { id: 'tool.b', handler: './tools/b.js', description: 'b' }
      ]
    },
    'tools/a.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({ which: \'a\' }) }',
    'tools/b.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({ which: \'b\' }) }'
  })

  const plugin = loadPlugin(dir)
  t.is(plugin.tools.length, 2, 'should have two tools')
  t.alike(plugin.tools.map((tool) => tool.id), ['tool.a', 'tool.b'], 'should preserve tool order')
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when manifest is not an object', (t) => {
  const dir = path.join(FIXTURES_DIR, 'manifest-not-object')
  writeFixture(dir, {
    'mcp-plugin.json': '"just a string"'
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
    t.ok(err.message.includes('must be a JSON object'), 'should mention the object requirement')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when manifest is malformed JSON', (t) => {
  const dir = path.join(FIXTURES_DIR, 'manifest-malformed-json')
  writeFixture(dir, {
    'mcp-plugin.json': '{ this is not valid json'
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should throw ERR_PLUGIN_MANIFEST_INVALID')
  }
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_HANDLER_NOT_FOUND when handler file has a syntax error', (t) => {
  const dir = path.join(FIXTURES_DIR, 'handler-syntax-error')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/broken.js', description: 'x' }]
    },
    'tools/broken.js': '\'use strict\'\nmodule.exports = { handler: function( {'
  })

  try {
    loadPlugin(dir)
    t.fail('should have thrown')
  } catch (err) {
    t.ok(err.message.startsWith('ERR_PLUGIN_HANDLER_NOT_FOUND'), 'should throw ERR_PLUGIN_HANDLER_NOT_FOUND')
    t.ok(err.message.includes('tool "x"'), 'should mention the tool id')
  }
  t.pass()
})

test('loadPlugin - carries annotations and agent metadata through verbatim', (t) => {
  const dir = path.join(FIXTURES_DIR, 'agent-meta')
  const agent = {
    enabled: true,
    answers: 'how many devices match a family and state',
    useWhen: ['how many miners are online', 'number of offline containers'],
    returns: 'a count with a one-line summary',
    minCapability: 'small'
  }
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'count_devices', handler: './tools/count.js', description: 'counts devices', annotations: { readOnlyHint: true }, agent }]
    },
    'tools/count.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({}) }'
  })

  const plugin = loadPlugin(dir)
  t.alike(plugin.tools[0].agent, agent, 'should carry the agent block unchanged')
  t.alike(plugin.tools[0].annotations, { readOnlyHint: true }, 'should carry annotations unchanged')
  t.pass()
})

test('loadPlugin - leaves annotations and agent undefined when not declared', (t) => {
  const dir = path.join(FIXTURES_DIR, 'no-agent-meta')
  writeFixture(dir, {
    'mcp-plugin.json': {
      name: '@test/p',
      version: '1.0.0',
      tools: [{ id: 'x', handler: './tools/x.js', description: 'x' }]
    },
    'tools/x.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({}) }'
  })

  const plugin = loadPlugin(dir)
  t.is(plugin.tools[0].agent, undefined, 'should not invent an agent block')
  t.is(plugin.tools[0].annotations, undefined, 'should not invent annotations')
  t.pass()
})

test('loadPlugin - throws ERR_PLUGIN_MANIFEST_INVALID when agent metadata is not an object', (t) => {
  for (const [label, agent] of [['string', 'small'], ['array', ['a']], ['null', null]]) {
    const dir = path.join(FIXTURES_DIR, 'bad-agent-' + label)
    writeFixture(dir, {
      'mcp-plugin.json': {
        name: '@test/p',
        version: '1.0.0',
        tools: [{ id: 'x', handler: './tools/x.js', description: 'x', agent }]
      },
      'tools/x.js': '\'use strict\'\nmodule.exports = { schema: {}, handler: async () => ({}) }'
    })

    try {
      loadPlugin(dir)
      t.fail('should have thrown for ' + label)
    } catch (err) {
      t.ok(err.message.includes('ERR_PLUGIN_MANIFEST_INVALID'), 'should reject an agent block that is a ' + label)
      t.ok(err.message.includes('"agent"'), 'should name the offending field')
    }
  }
  t.pass()
})
