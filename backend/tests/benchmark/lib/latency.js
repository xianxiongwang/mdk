'use strict'

// Per-operation latency recorder for the "Latency metrics template" rows in
// capacity-metrics-template.md. All latencies in milliseconds, same
// percentile set (p50/p95/p99/max) and `n` on every row so results are
// comparable across profiles.

const { percentile } = require('./metrics')

class LatencyRecorder {
  constructor (label) {
    this.label = label
    this.samplesMs = []
    this.errors = 0
  }

  record (ms) {
    this.samplesMs.push(ms)
  }

  recordError () {
    this.errors += 1
  }

  // Times an async fn, recording success latency or bumping the error count.
  // Returns the fn's resolved value, or undefined if it threw.
  async time (fn) {
    const start = process.hrtime.bigint()
    try {
      const result = await fn()
      this.record(Number(process.hrtime.bigint() - start) / 1e6)
      return result
    } catch (err) {
      this.recordError()
      return undefined
    }
  }

  summary () {
    const sorted = [...this.samplesMs].sort((a, b) => a - b)
    return {
      label: this.label,
      n: sorted.length,
      errors: this.errors,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      maxMs: sorted.length ? sorted[sorted.length - 1] : null
    }
  }
}

module.exports = { LatencyRecorder }
