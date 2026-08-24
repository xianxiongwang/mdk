import { streamText } from 'ai'
import { createQvac } from '@qvac/ai-sdk-provider'

/**
 * Turn a provider config into a live model handle, hiding the mode and the underlying SDK
 * from the rest of the agent.
 *
 * The qvac modes differ only in who owns the serve process: `external` connects to an
 * already-running server by URL (also the shared-inference-server shape), `managed` spawns
 * one, which requires the agent and the GPU to share an OS.
 */
export async function resolveProvider (cfg) {
  switch (cfg.kind) {
    case 'qvac': return createQvacProvider(cfg)
    // future: 'openai-compatible' for cloud / self-hosted endpoints
    default: throw new Error(`unknown provider kind: ${cfg.kind}`)
  }
}

async function createQvacProvider (cfg) {
  const mode = cfg.mode ?? (cfg.baseURL ? 'external' : 'managed')
  const modelId = cfg.model
  if (!modelId) throw new Error('qvac provider needs a `model`')

  let qvac
  let close = async () => {}

  if (mode === 'external') {
    if (!cfg.baseURL) throw new Error('qvac external mode needs `baseURL` (e.g. http://127.0.0.1:11500/v1)')
    qvac = createQvac({ baseURL: cfg.baseURL, apiKey: cfg.apiKey ?? 'qvac' })
  } else if (mode === 'managed') {
    // ctx_size / reasoning_budget must be passed — the serve defaults (ctx 1024) are too small.
    const spec = { name: modelId, config: { ctx_size: 16384, reasoning_budget: 0, ...(cfg.modelConfig ?? {}) } }
    qvac = await createQvac({ mode: 'managed', models: [spec], serveStartTimeout: 15 * 60 * 1000 })
    close = () => qvac.close()
  } else {
    throw new Error(`unknown qvac mode: ${mode}`)
  }

  return {
    kind: 'qvac',
    mode,
    modelId,
    baseURL: cfg.baseURL,
    // A fresh AI SDK model handle for each call (stateless; cheap).
    model: () => qvac(modelId),
    close,

    // Poll a 1-token generation until the model answers. Rides out the first-run
    // download / cold-start window where the server replies "model not ready".
    async waitReady ({ timeoutMs = 12 * 60 * 1000, onWait } = {}) {
      const t0 = Date.now()
      let attempt = 0
      while (Date.now() - t0 < timeoutMs) {
        try {
          const r = streamText({ model: qvac(modelId), prompt: 'hi', maxOutputTokens: 1, maxRetries: 0 })
          const it = r.fullStream[Symbol.asyncIterator]()
          for (let step = await it.next(); !step.done; step = await it.next()) { /* drain */ }
          await r.finishReason
          return Date.now() - t0
        } catch (err) {
          if (!isTransient(err)) throw err
          onWait?.(++attempt, Date.now() - t0)
          await sleep(3000)
        }
      }
      throw new Error(`model "${modelId}" not ready within ${Math.round(timeoutMs / 1000)}s`)
    }
  }
}

// "Still starting up" errors we should wait through, vs. real failures to surface.
function isTransient (err) {
  return /not ready|not loaded|model_not_ready|no output generated|503|fetch failed|ECONNREFUSED|socket|terminated/i
    .test(errChain(err))
}

function errChain (e, depth = 0) {
  if (!e || depth > 6) return ''
  let data = ''
  try { data = JSON.stringify(e.data ?? e.responseBody ?? '') } catch {}
  return [e.name, e.message, data, errChain(e.cause, depth + 1)].filter(Boolean).join(' ')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
