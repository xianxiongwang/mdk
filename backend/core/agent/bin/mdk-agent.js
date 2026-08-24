#!/usr/bin/env node
// MDK agent CLI — a streaming chat REPL over a local model and, optionally, an MCP tool
// server, with human approval for writes. See README.md for usage and flags.

import readline from 'node:readline'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import { createAgent, EVENT, runBattery, coverageGaps, loadBattery, selectCases } from '../index.js'
import { parseArgs, evalOptions } from '../src/args.js'
import { formatReport, formatResult } from '../src/report.js'
import { DEFAULT_LIMITS, DEFAULT_ENDPOINTS } from '../src/constants.js'

// ── terminal colors (kept minimal; presentation-friendly) ──────────────────────
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  orange: '\x1b[38;2;247;147;26m', // bitcoin orange (truecolor)
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m'
}
const ok = `${C.green}✓${C.reset}`

// The terminal's colours, handed to the report renderer. The renderer itself knows nothing
// about ANSI, so the same report can be written to a file without escape codes in it.
const PAINT = {
  bold: (s) => `${C.bold}${s}${C.reset}`,
  dim: (s) => `${C.dim}${s}${C.reset}`,
  good: (s) => `${C.green}${s}${C.reset}`,
  warn: (s) => `${C.yellow}${s}${C.reset}`,
  bad: (s) => `${C.orange}${s}${C.reset}`
}

const args = parseArgs(process.argv.slice(2))
const provider = {
  kind: 'qvac',
  mode: args.mode ?? 'external',
  baseURL: args['base-url'] ?? DEFAULT_ENDPOINTS.model,
  model: args.model ?? 'qwen3-600m'
}
const mcpUrl = args['mcp-url'] ?? null

// Checked before anything connects: waiting on a model load to then reject the flags would
// spend a minute to report a typo.
let evalOpts = null
if (args.eval) {
  if (!mcpUrl) fail(`--eval needs a tool server:  --mcp-url ${DEFAULT_ENDPOINTS.mcp}`)
  try {
    evalOpts = evalOptions(args)
  } catch (err) {
    fail(err.message)
  }
}

console.log(banner())
field('provider', `qvac (${provider.mode})`)
field('model', provider.model)
if (provider.mode === 'external') field('endpoint', provider.baseURL)
field('mcp', mcpUrl ?? 'none (plain chat)')
console.log('')

let agent
try {
  agent = await createAgent({
    provider,
    mcp: mcpUrl ? { url: mcpUrl } : undefined,
    limits: DEFAULT_LIMITS
  })
} catch (err) {
  console.error(`Failed to start: ${err.message}`)
  if (mcpUrl) console.error(`(is the MCP server running at ${mcpUrl}?)`)
  process.exit(1)
}
const tools = agent.tools ?? []
const skipped = agent.skipped ?? []
if (mcpUrl) {
  const mark = tools.length ? ok : `${C.yellow}⚠${C.reset}`
  console.log(`${mark} connected to MCP — ${tools.length} tools admitted${tools.length ? `: ${C.dim}${tools.map((t) => t.name).join(', ')}${C.reset}` : ''}`)
  for (const s of skipped) console.log(`  ${C.gray}skipped${C.reset} ${s.name} ${C.dim}— ${s.reason}${C.reset}`)
  // Admitting nothing is a valid outcome of the contract, and the reason it is loud: the agent
  // would otherwise start cleanly and then decline every fleet question.
  if (!tools.length) console.log(`  ${C.yellow}no tools admitted — the agent will answer from the charter only${C.reset}`)
}

process.stdout.write('connecting to model… ')
try {
  const ms = await agent.waitReady({
    onWait: (_n, elapsed) => process.stdout.write(`\rwaiting for model to load… (${Math.round(elapsed / 1000)}s)   `)
  })
  console.log(`\r${ok} model ready ${C.dim}(${ms} ms)${C.reset}                      `)
} catch (err) {
  console.error(`\n\nCould not reach the model: ${err.message}`)
  if (provider.mode === 'external') console.error(`Is the QVAC server serving "${provider.model}" at ${provider.baseURL}?`)
  process.exit(1)
}

if (args.eval) await runEval()

const session = await agent.createSession()

const COMMANDS = ['/about', '/tools', '/info', '/new', '/exit']

console.log(`\n  session ${C.dim}${session.id}${C.reset} · type ${C.cyan}/about${C.reset} to learn what this is · ${COMMANDS.slice(1).map((c) => `${C.cyan}${c}${C.reset}`).join(' ')}\n`)

// ── line reader: one 'line' listener feeding a queue, so we can read a line for a
//    message OR for a mid-turn approval answer without readline conflicts. ──────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const queue = []
let waiter = null
rl.on('line', (line) => {
  if (waiter) { const w = waiter; waiter = null; w(line) } else queue.push(line)
})
rl.on('close', () => shutdown())
function readLine () {
  return queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => { waiter = resolve })
}

await repl()

async function repl () {
  for (;;) {
    process.stdout.write(`${C.orange}you${C.reset} ${C.gray}›${C.reset} `)
    const msg = (await readLine()).trim()
    if (!msg) continue
    // A mistyped command is a question to the model otherwise: it costs a turn, and it stays in
    // the stored history for every turn after it.
    const cmd = /^\/\w+$/.test(msg) ? msg.toLowerCase() : null
    if (cmd && !COMMANDS.includes(cmd)) {
      console.log(`(unknown command ${msg} — try ${COMMANDS.join(' ')})\n`)
      continue
    }
    if (cmd === '/exit') return shutdown()
    if (cmd === '/about') { console.log(about()); continue }
    if (cmd === '/new') {
      try {
        await session.reset()
        console.log('(conversation reset)\n')
      } catch (err) {
        console.log(`(could not reset — the conversation is unchanged: ${err.message})\n`)
      }
      continue
    }
    if (cmd === '/info') {
      printInfo(); console.log(`  session  : ${session.id} (${session.messages.length} messages)\n`); continue
    }
    if (cmd === '/tools') { printTools(); continue }

    const t0 = performance.now()
    let ttft = null
    let approvalWait = 0 // time spent waiting on the human at [y/N] — not the agent's latency
    let answerStarted = false
    const iter = session.send(msg)
    let sent
    for (;;) {
      const { value: ev, done } = await iter.next(sent)
      sent = undefined
      if (done) break
      if (ev.type === EVENT.PENDING_APPROVAL) {
        process.stdout.write(`\n  ${C.yellow}⚠ approval${C.reset}  ${C.bold}${ev.name}${C.reset}${C.dim}(${compact(JSON.stringify(ev.args))})${C.reset}`)
        process.stdout.write(`\n  ${C.gray}execute this action? [y/N]${C.reset} `)
        const aStart = performance.now()
        const ans = (await readLine()).trim()
        approvalWait += performance.now() - aStart
        sent = /^y(es)?$/i.test(ans)
        console.log(sent ? `  ${C.green}✓ approved${C.reset}` : `  ${C.gray}✗ rejected${C.reset}`)
      } else if (ev.type === EVENT.TOOL_CALL) {
        process.stdout.write(`\n  ${C.cyan}→ tool${C.reset}   ${ev.name}${C.dim}(${compact(JSON.stringify(ev.args))})${C.reset}`)
      } else if (ev.type === EVENT.TOOL_RESULT) {
        const preview = ev.text.replace(/\s+/g, ' ').trim().slice(0, 100)
        process.stdout.write(`\n  ${C.gray}← data${C.reset}   ${C.dim}${preview}${ev.text.length > 100 ? '…' : ''}${C.reset}`)
      } else if (ev.type === EVENT.TOKEN) {
        if (!answerStarted) { process.stdout.write(`\n\n  ${C.orange}▌${C.reset} ${C.bold}`); answerStarted = true }
        if (ttft === null) ttft = performance.now() - t0 - approvalWait
        process.stdout.write(ev.text)
      } else if (ev.type === EVENT.ERROR) {
        process.stdout.write(`\n  ${C.yellow}⚠ error${C.reset}  ${ev.error}`)
      }
    }
    if (answerStarted) process.stdout.write(C.reset) // close the bold answer block
    // Report only the agent's own latency — subtract time the human spent at [y/N].
    const total = performance.now() - t0 - approvalWait
    const secs = (ms) => `${(ms / 1000).toFixed(1)}s`
    process.stdout.write(`\n  ${C.dim}${secs(total)}${ttft != null ? ` · first token ${secs(ttft)}` : ''} · ${provider.model}${C.reset}\n\n`)
  }
}

// The eval battery, run in place of the REPL. Exits non-zero on any failure, so a run is a
// gate: the report it writes is the evidence a new tool works, not a claim that it does.
async function runEval () {
  const { reps, concurrency, only, tag, out } = evalOpts

  let battery
  try {
    battery = loadBattery()
  } catch (err) {
    return fail(`battery: ${err.message}`)
  }
  const selected = selectCases(battery, { only, tag }).length
  console.log(`\n  ${C.bold}eval battery${C.reset} ${C.dim}· ${selected} cases × ${reps} rep${reps > 1 ? 's' : ''} · ${provider.model}${C.reset}\n`)

  const gaps = coverageGaps(tools, battery)
  if (gaps.length && !only && !tag) console.log(`  ${C.yellow}no case covers: ${gaps.join(', ')}${C.reset}\n`)

  let report
  try {
    report = await runBattery({
      agent,
      mcp: agent.mcp,
      cases: battery,
      reps,
      only,
      tag,
      concurrency,
      onResult: (r) => console.log(formatResult(r, { paint: PAINT }))
    })
  } catch (err) {
    console.error(`\n  eval could not run: ${err.message}`)
    await agent.close()
    process.exit(1)
  }

  console.log(formatReport(report, { paint: PAINT }))

  // An unwritable path must not turn a passing run into a non-zero exit, nor throw away the
  // twenty minutes of results already printed above.
  let writeFailed = false
  if (out) {
    try {
      writeFileSync(out, JSON.stringify({ model: provider.model, mcp: mcpUrl, ...report }, null, 2))
      console.log(`  ${C.dim}report written to ${out}${C.reset}`)
    } catch (err) {
      writeFailed = true
      console.error(`  could not write ${out}: ${err.message}`)
    }
  }
  console.log('')
  await agent.close()
  process.exit(report.failed || writeFailed ? 1 : 0)
}

async function shutdown () {
  await agent.close()
  console.log('\nbye.')
  process.exit(0)
}

function printInfo () {
  console.log(`  provider : qvac (${provider.mode})`)
  console.log(`  model    : ${provider.model}`)
  if (provider.mode === 'external') console.log(`  endpoint : ${provider.baseURL}`)
  console.log(`  mcp      : ${mcpUrl ?? 'none'}`)
  console.log(`  tools    : ${tools.length ? tools.map((t) => t.name).join(', ') : 'none (plain chat)'}`)
}

function printTools () {
  if (!tools.length) {
    console.log(`  no tools connected — start with:  --mcp-url ${DEFAULT_ENDPOINTS.mcp}`)
  } else {
    for (const t of tools) console.log(`  - ${t.name}: ${t.description ?? ''}`)
  }
  console.log('')
}

function compact (s) { return s.length > 60 ? s.slice(0, 57) + '…' : s }

function fail (message) {
  console.error(message)
  process.exit(1)
}

function field (k, v) { console.log(`  ${C.gray}${k.padEnd(8)}${C.reset} ${v}`) }

function banner () {
  const o = (s) => C.orange + s + C.reset
  return [
    '',
    o('   ███╗   ███╗ ██████╗ ██╗  ██╗'),
    o('   ████╗ ████║ ██╔══██╗██║ ██╔╝'),
    o('   ██╔████╔██║ ██║  ██║█████╔╝ '),
    o('   ██║╚██╔╝██║ ██║  ██║██╔═██╗ '),
    o('   ██║ ╚═╝ ██║ ██████╔╝██║  ██╗'),
    o('   ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝'),
    o('    █████╗  ██████╗ ███████╗███╗   ██╗████████╗'),
    o('   ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝'),
    o('   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   '),
    o('   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   '),
    o('   ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   '),
    o('   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   '),
    C.dim + '   Operator assistant for mining fleets · local model · real fleet tools' + C.reset,
    ''
  ].join('\n')
}

function about () {
  const dot = `${C.green}●${C.reset}`
  const d = (s) => C.dim + s + C.reset
  return [
    '',
    `  ${C.bold}MDK Agent — what this is${C.reset}`,
    '  A conversational assistant for MDK mining sites. Ask in plain language;',
    '  it answers with live fleet data, or performs approval-gated actions.',
    '',
    `  ${dot} Runs on a ${C.bold}local${C.reset} model (QVAC · Qwen3-4B on GPU) — data never leaves the site`,
    `  ${dot} Answers are ${C.bold}grounded${C.reset} in MDK fleet tools over MCP — it never invents data`,
    `  ${dot} Write actions (reboot, set power mode) require your ${C.bold}explicit approval${C.reset}`,
    `  ${dot} No tool for the question? It says so ${C.bold}honestly${C.reset} instead of guessing`,
    '',
    d('  Try:  "how many miners are on the site?"'),
    d('        "list the devices that are not ready"'),
    d('        "restart antminer-3"'),
    ''
  ].join('\n')
}
