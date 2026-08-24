import test from 'brittle'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'
import { runToolLoop } from '../../src/loop.js'
import { EVENT } from '../../src/events.js'
import { admitTools, AGENT_META_KEY, CAPABILITY, TOOL_CONTRACT_VERSION } from '../../src/tools.js'

const toolFixture = ({ name, answers, readOnlyHint }) => ({
  name,
  description: answers,
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint },
  _meta: {
    [AGENT_META_KEY]: {
      enabled: true,
      answers,
      useWhen: [`${name} question`],
      returns: 'a result',
      minCapability: CAPABILITY.SMALL,
      contract: TOOL_CONTRACT_VERSION
    }
  }
})

const { admitted: TOOLS } = admitTools([
  toolFixture({ name: 'get_site_overview', answers: 'How the site is doing.', readOnlyHint: true })
])
const { admitted: WRITE_TOOLS } = admitTools([
  toolFixture({ name: 'act_device', answers: 'Acts on a device.', readOnlyHint: false })
])
const MCP = { callTool: async () => ({ text: '{"miners":15}', isError: false }) }

// Emits each text in turn, one per step, so a test can script a tool call followed by an answer.
function scriptedModel (texts) {
  let step = 0
  return new MockLanguageModelV3({
    doStream: async () => {
      const text = texts[Math.min(step++, texts.length - 1)]
      return {
        stream: convertArrayToReadableStream([
          { type: 'text-start', id: '0' },
          { type: 'text-delta', id: '0', delta: text },
          { type: 'text-end', id: '0' },
          { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
        ])
      }
    }
  })
}

// Runs the loop to completion, answering every approval prompt with `approve`, and returns
// the messages the model saw on the LAST step.
async function historyOnFinalStep (texts, { approve = true, maxSteps = 3, tools = TOOLS, prompt = 'how many miners?' } = {}) {
  let seen = []
  const model = scriptedModel(texts)
  const inner = model.doStream
  model.doStream = async (opts) => {
    seen = opts.prompt.filter((m) => m.role !== 'system')
    return inner(opts)
  }
  const loop = runToolLoop({
    model,
    system: 'charter',
    messages: [{ role: 'user', content: prompt }],
    tools,
    mcp: MCP,
    maxSteps
  })
  let sent
  for (;;) {
    const { value: ev, done } = await loop.next(sent)
    sent = undefined
    if (done) break
    if (ev.type === EVENT.PENDING_APPROVAL) sent = approve
  }
  return seen
}

const assistantText = (history) => {
  const m = history.find((msg) => msg.role === 'assistant')
  if (!m) return null
  return typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join('')
}

// The KV cache keys on the conversation, so a rewritten assistant turn misses it and the
// whole conversation is re-prefilled. Re-serializing the same call is enough to break it:
// `{"tool": "x", "args": {}}` and `{"tool":"x","args":{}}` are different keys.
const SPACED_CALL = '{"tool": "get_site_overview", "args": {}}'

test('a tool call is replayed to the model exactly as it was emitted', async (t) => {
  const history = await historyOnFinalStep([SPACED_CALL, '15 miners.'])
  t.is(assistantText(history), SPACED_CALL, 'the spacing the model produced survives the round trip')
})

test('a rejected tool call is also replayed exactly as emitted', async (t) => {
  const emitted = '{"tool": "act_device", "args": {"id": "antminer-3"}}'
  const history = await historyOnFinalStep([emitted, 'Cancelled.'], {
    approve: false,
    tools: WRITE_TOOLS,
    prompt: 'reboot antminer-3'
  })
  t.is(assistantText(history), emitted)
})

test('trailing braces the parser tolerates are replayed too, and the loop still resolves', async (t) => {
  // extractJsonObject deliberately accepts `{...}}}}`; replaying it verbatim means the model
  // sees its own malformed output. Pin that the turn still completes.
  const messy = '{"tool": "get_site_overview", "args": {}}}}'
  const history = await historyOnFinalStep([messy, '15 miners.'])
  t.is(assistantText(history), messy)
})

test('the tool result is fed back as a user message after the assistant turn', async (t) => {
  const history = await historyOnFinalStep([SPACED_CALL, '15 miners.'])
  const roles = history.map((m) => m.role)
  t.alike(roles, ['user', 'assistant', 'user'])
  t.ok(history.at(-1).content.at(0).text.includes('{"miners":15}'), 'the raw tool output reaches the model')
})
