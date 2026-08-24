// Unit tests for the pure parsing/formatting logic in the tool loop:
//   - extractJsonObject: balanced, string-aware object extraction
//   - parseToolCall: valid calls, arg defaulting, rejections
//   - buildToolSystem: the charter plus the rendered tool contract

import test from 'brittle'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'
import { runToolLoop, parseToolCall, extractJsonObject, buildToolSystem, contractViolation } from '../../src/loop.js'
import { requiresApproval } from '../../src/constants.js'
import { EVENT } from '../../src/events.js'
import { admitTools, renderTools, AXIS, CAPABILITY, AGENT_META_KEY, TOOL_CONTRACT_VERSION } from '../../src/tools.js'

// ── requiresApproval: the safety boundary — fails SAFE ───────────────────────

test('requiresApproval gates writes and unknown tools, allows read verbs', (t) => {
  t.is(requiresApproval('count_devices'), false)
  t.is(requiresApproval('list_devices'), false)
  t.is(requiresApproval('summarize_site'), false)
  t.is(requiresApproval('act_device'), true) // the write verb → ask
  t.is(requiresApproval('send_command'), true) // off-taxonomy → ask (fail safe)
  t.is(requiresApproval('some_new_write_tool'), true)
})

test('requiresApproval honours the MCP readOnlyHint annotation', (t) => {
  t.is(requiresApproval('anything', { annotations: { readOnlyHint: true } }), false)
  // an explicit write hint overrides the verb
  t.is(requiresApproval('count_devices', { annotations: { readOnlyHint: false } }), true)
})

// ── extractJsonObject ────────────────────────────────────────────────────────

test('extractJsonObject returns the first balanced object', (t) => {
  t.is(extractJsonObject('{"a":1}'), '{"a":1}')
  t.is(extractJsonObject('prefix {"a":{"b":2}} suffix'), '{"a":{"b":2}}')
})

test('extractJsonObject stops at the first balanced close, ignoring stray braces', (t) => {
  // the exact malformed shape small models emit: trailing }}}
  t.is(extractJsonObject('{"tool":"x","args":{}}}}'), '{"tool":"x","args":{}}')
})

test('extractJsonObject ignores braces inside strings', (t) => {
  t.is(extractJsonObject('{"msg":"a}b"}'), '{"msg":"a}b"}')
})

test('extractJsonObject returns null when there is no balanced object', (t) => {
  t.is(extractJsonObject('no braces here'), null)
  t.is(extractJsonObject('{ unbalanced'), null)
})

// ── parseToolCall ────────────────────────────────────────────────────────────

test('parseToolCall parses a valid tool call', (t) => {
  t.alike(parseToolCall('{"tool":"get_status","args":{}}'), { tool: 'get_status', args: {} })
})

test('parseToolCall defaults args to {} when absent', (t) => {
  t.alike(parseToolCall('{"tool":"get_site_overview"}'), { tool: 'get_site_overview', args: {} })
})

test('parseToolCall reads nested args', (t) => {
  t.alike(
    parseToolCall('{"tool":"send_command","args":{"deviceId":"antminer-3","params":{"mode":"high"}}}'),
    { tool: 'send_command', args: { deviceId: 'antminer-3', params: { mode: 'high' } } }
  )
})

test('parseToolCall tolerates prose before the object and stray trailing braces', (t) => {
  t.alike(
    parseToolCall('Sure: {"tool":"list_devices","args":{"type":"miner"}}}}'),
    { tool: 'list_devices', args: { type: 'miner' } }
  )
})

test('parseToolCall returns null for a plain-text answer', (t) => {
  t.is(parseToolCall('There are 15 miners on the site.'), null)
})

test('parseToolCall returns null when there is no string tool key', (t) => {
  t.is(parseToolCall('{"foo":1}'), null)
  t.is(parseToolCall('{"tool":42}'), null)
})

// ── buildToolSystem (enum + default surfacing) ───────────────────────────────

test('the coverage boundary reaches the prompt and is configurable there', (t) => {
  const tool = {
    name: 'count_devices',
    description: 'How many devices.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    _meta: {
      'x-mdk-agent': {
        enabled: true,
        answers: 'How many devices.',
        useWhen: ['how many miners', 'device count'],
        notFor: [],
        outOfScope: [],
        returns: 'a count',
        minCapability: 'small',
        contract: TOOL_CONTRACT_VERSION
      }
    }
  }

  t.ok(buildToolSystem('CHARTER', [tool]).includes('NONE of these tools answers'), 'the default boundary is rendered')
  t.ok(buildToolSystem('CHARTER', [tool], { notCovered: ['pool payouts'] }).includes('pool payouts'), 'a consumer can replace it')

  const dropped = buildToolSystem('CHARTER', [tool], { notCovered: [] })
  t.absent(dropped.includes('NONE of these tools answers'), 'and drop it entirely')
  t.absent(/\n\n\n/.test(dropped), 'without leaving a gap where the block was')
})

// ── what reaches the operator (never JSON) ───────────────────────────────────

const { admitted: LOOP_TOOLS } = admitTools([{
  name: 'get_site_overview',
  description: 'How the site is doing.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  _meta: {
    [AGENT_META_KEY]: {
      enabled: true,
      answers: 'How the site is doing.',
      useWhen: ['how is the site'],
      returns: 'a summary',
      minCapability: CAPABILITY.SMALL,
      contract: TOOL_CONTRACT_VERSION
    }
  }
}])

const LOOP_MCP = { callTool: async () => ({ text: '{"miners":15}', isError: false }) }

// Streams `texts[step]` per step and returns `generated` from the non-streaming call the
// step-exhaustion path makes.
function scriptedModel (texts, generated = texts.at(-1)) {
  let step = 0
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'text-start', id: '0' },
        { type: 'text-delta', id: '0', delta: texts[Math.min(step++, texts.length - 1)] },
        { type: 'text-end', id: '0' },
        { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      ])
    }),
    doGenerate: async () => ({
      content: [{ type: 'text', text: generated }],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: []
    })
  })
}

async function collect (model, { maxSteps = 3 } = {}) {
  const events = []
  const loop = runToolLoop({
    model,
    system: 'charter',
    messages: [{ role: 'user', content: 'how is the site?' }],
    tools: LOOP_TOOLS,
    mcp: LOOP_MCP,
    maxSteps
  })
  for await (const ev of loop) events.push(ev)
  return events
}

const terminals = (events) => events.filter((e) => e.type === EVENT.DONE || e.type === EVENT.ERROR)
const spoken = (events) => events.filter((e) => e.type === EVENT.TOKEN).map((e) => e.text).join('')

test('step exhaustion never shows the operator JSON', async (t) => {
  // The model calls a tool on every step and answers the final prompt with JSON too.
  const call = '{"tool":"get_site_overview","args":{}}'
  const events = await collect(scriptedModel([call], '{"tool":"act_device","args":{"ref":"container-1"}}'), { maxSteps: 2 })

  const text = spoken(events)
  t.absent(text.includes('{'), 'no JSON reached the operator')
  t.absent(/tool/i.test(text), 'and no tool is named')
  t.ok(text.length > 0, 'something plain-English was said instead')
  t.is(terminals(events).length, 1, 'exactly one terminal event')
  t.is(terminals(events)[0].type, EVENT.DONE)
  t.is(events.at(-1).type, EVENT.DONE, 'and it is last')
})

test('an unparseable tool call never shows the operator JSON', async (t) => {
  // Opens like a call but never balances, so the repair budget is spent and the loop gives up.
  const events = await collect(scriptedModel(['{"tool": "act_device", "args": {"ref":']), { maxSteps: 5 })

  const text = spoken(events)
  t.absent(text.includes('{'), 'the malformed object is withheld')
  t.absent(text.includes('act_device'), 'and so is the tool name')
  t.is(terminals(events).length, 1, 'exactly one terminal event')
  t.is(events.at(-1).type, EVENT.DONE, 'and it is last')
})

test('a plain prose answer is passed through untouched', async (t) => {
  const events = await collect(scriptedModel(['The site is healthy: 15 miners hashing.']))

  t.is(spoken(events), 'The site is healthy: 15 miners hashing.')
  t.is(terminals(events).length, 1, 'exactly one terminal event')
  t.is(events.at(-1).type, EVENT.DONE, 'and it is last')
})

test('buildToolSystem returns the charter unchanged when there are no tools', (t) => {
  t.is(buildToolSystem('CHARTER', []), 'CHARTER')
})

test('buildToolSystem wraps the rendered contract with the calling instructions', (t) => {
  const [tool] = admitTools([{
    name: 'list_devices',
    description: 'Which devices, by family and state.',
    inputSchema: {
      type: 'object',
      properties: {
        family: { type: 'string', enum: AXIS.family, default: 'all' },
        state: { type: 'string', enum: AXIS.state, default: 'all' }
      }
    },
    annotations: { readOnlyHint: true },
    _meta: {
      [AGENT_META_KEY]: {
        enabled: true,
        answers: 'Which devices, by family and state.',
        useWhen: ['list the miners', 'what is offline'],
        notFor: ['counting them (use count_devices)'],
        returns: 'the matching devices with a one-line summary',
        minCapability: CAPABILITY.SMALL,
        contract: TOOL_CONTRACT_VERSION
      }
    }
  }]).admitted

  const out = buildToolSystem('CHARTER', [tool])
  t.ok(out.startsWith('CHARTER'), 'the charter stays the prefix')
  t.ok(out.includes(renderTools([tool])), 'the tool block comes from the contract renderer')
  t.ok(out.includes('{"tool": "<tool_name>", "args": { ... }}'), 'the call format is stated')
  t.ok(out.includes('use one of those values exactly'), 'and the enum instruction is value-neutral')
})

const contractTool = (name) => admitTools([{
  name,
  description: 'x',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  _meta: {
    [AGENT_META_KEY]: {
      enabled: true,
      answers: 'x',
      useWhen: ['a', 'b'],
      returns: 'x',
      minCapability: CAPABILITY.SMALL,
      contract: TOOL_CONTRACT_VERSION
    }
  }
}]).admitted[0]

test('a result that breaks its verb contract is caught before the model sees it', (t) => {
  const tool = contractTool('list_devices')

  t.ok(/count \(9\) disagrees/.test(contractViolation(tool, '{"summary":"x","count":9,"total":9,"items":[]}')),
    'count must equal what was listed')
  t.ok(/exceeds total/.test(contractViolation(tool, '{"summary":"x","count":2,"total":1,"items":[{"a":1},{"a":2}]}')),
    'and cannot exceed what matched')
  t.is(contractViolation(tool, '{"summary":"two","count":2,"total":9,"items":[{"a":1},{"a":2}]}'), null,
    'a truncated list is fine when it says so')
})

// Enforcement folds the breach into the text and marks the call failed, which is exactly what
// an infrastructure error looks like. Without the reason on the event, a report cannot tell the
// two apart, and every enforced violation is counted as none.
test('an enforced violation is named on the event, not only in the text', async (t) => {
  const { admitted: [tool] } = admitTools([{
    name: 'count_devices',
    description: 'How many devices.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    _meta: {
      [AGENT_META_KEY]: {
        enabled: true,
        answers: 'How many devices.',
        useWhen: ['how many miners', 'device count'],
        returns: 'a count',
        minCapability: CAPABILITY.SMALL,
        contract: TOOL_CONTRACT_VERSION
      }
    }
  }])

  const events = []
  const loop = runToolLoop({
    model: scriptedModel(['{"tool":"count_devices","args":{}}', 'There are 15.']),
    system: 'charter',
    messages: [{ role: 'user', content: 'how many miners?' }],
    tools: [tool],
    mcp: { callTool: async () => ({ text: '{"summary":"15 miners."}', isError: false }) },
    maxSteps: 3
  })
  for await (const ev of loop) events.push(ev)

  const result = events.find((e) => e.type === EVENT.TOOL_RESULT)
  t.ok(result.isError, 'the call is failed, so the model is told to stop')
  t.ok(/missing "count"/.test(result.contractViolation ?? ''), 'and the reason is readable without parsing the text')
})

test('a well-formed result carries no violation marker', async (t) => {
  const events = await collect(scriptedModel(['{"tool":"get_site_overview","args":{}}', 'All good.']))
  const result = events.find((e) => e.type === EVENT.TOOL_RESULT)

  t.is(result.contractViolation, undefined, 'the field is absent rather than null on a clean call')
})

test('only a tool that declares the contract is judged by it', (t) => {
  const legacy = { name: 'get_site_overview' } // no agent metadata
  t.is(contractViolation(legacy, '{"miners":15}'), null, 'a legacy tool passes untouched')
  t.is(contractViolation(undefined, '{"anything":1}'), null, 'and so does one we know nothing about')

  const tool = contractTool('get_device')
  t.is(contractViolation(tool, 'plain prose, not JSON'), null, 'prose is not a contract breach')
  t.is(contractViolation(tool, '[1,2,3]'), null, 'nor is a bare array')
})
