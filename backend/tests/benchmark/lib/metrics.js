'use strict'

// Resource sampling for the "Per process" tables in
// capacity-metrics-template.md. Every profile run boots mocks/Kernel/each
// Worker as separate OS processes (see processes/run-process.js), so this
// always samples another process by pid via `ps` — never the sampler's own
// process. `ps` CPU% is the OS's own instantaneous/decaying average.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function percentile (sortedAsc, p) {
  if (!sortedAsc.length) return null
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1))
  return sortedAsc[idx]
}

function bytesToMiB (b) {
  return b / (1024 * 1024)
}

// Real on-disk size of a directory tree (Hyperbee/Corestore files, not a
// single file) — used both to snapshot a worker store's size at the start
// of a run (processes/run-process.js) and again at report-render time
// (lib/report.js), so Storage breakdown can compute a real growth/day
// instead of a placeholder.
function dirSizeBytes (dirPath) {
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)
    total += entry.isDirectory() ? dirSizeBytes(entryPath) : fs.statSync(entryPath).size
  }
  return total
}

class ResourceSampler {
  constructor ({ pid, intervalMs = 250, label = 'process' } = {}) {
    if (!pid) throw new Error('ERR_RESOURCE_SAMPLER_PID_REQUIRED')
    this.pid = pid
    this.intervalMs = intervalMs
    this.label = label
    this.samples = []
    this.fdSamples = []
    this._timer = null
  }

  _sample () {
    const now = Date.now()
    try {
      const out = execFileSync('ps', ['-o', 'rss=,pcpu=', '-p', String(this.pid)], { encoding: 'utf8' }).trim()
      if (!out) return
      const [rssKb, pcpu] = out.split(/\s+/).map(Number)
      this.samples.push({ t: now, cpuPct: pcpu, rssMiB: rssKb / 1024 })
    } catch {
      // process not found (already exited) — skip this tick, don't throw
    }
  }

  // Only taken at start()/stop(), not every tick like _sample() — lsof is
  // far more expensive than `ps` (a full system fd scan vs. one process
  // lookup), so this gives a real 2-point open-fd delta across the sampling
  // window without adding per-tick overhead to every CPU/RSS sample.
  _sampleFd () {
    const now = Date.now()
    try {
      const out = execFileSync('lsof', ['-p', String(this.pid)], { encoding: 'utf8' })
      const lineCount = out.split('\n').filter(Boolean).length
      this.fdSamples.push({ t: now, fdCount: Math.max(0, lineCount - 1) }) // -1 for lsof's own header row
    } catch {
      // lsof unavailable, or process not found (already exited) — skip
    }
  }

  start () {
    if (this._timer) return this
    this._sample()
    this._sampleFd()
    this._timer = setInterval(() => this._sample(), this.intervalMs)
    this._timer.unref()
    return this
  }

  stop () {
    if (this._timer) clearInterval(this._timer)
    this._timer = null
    this._sampleFd()
    return this
  }

  // Callers that read summary() well before stop() (e.g. runChecklist, to
  // report mid-flight while a later failure drill may still kill this
  // process) should call this first — otherwise fdSamples only ever has
  // start()'s single point and every fd slope reads null.
  sampleFdNow () {
    this._sampleFd()
    return this
  }

  summary () {
    if (!this.samples.length) {
      return { label: this.label, samples: 0, avgCpuPct: null, peakCpuPct: null, avgRssMiB: null, peakRssMiB: null, rssSlopeMiBPerHour: null, fdCountFirst: null, fdCountLast: null, fdSlopePerHour: null }
    }
    const cpu = this.samples.map((s) => s.cpuPct)
    const rss = this.samples.map((s) => s.rssMiB)
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
    const max = (arr) => arr.length ? Math.max(...arr) : null
    return {
      label: this.label,
      mode: 'external-ps',
      samples: this.samples.length,
      avgCpuPct: avg(cpu),
      peakCpuPct: max(cpu),
      avgRssMiB: avg(rss),
      peakRssMiB: max(rss),
      firstRssMiB: rss[0],
      lastRssMiB: rss[rss.length - 1],
      rssSlopeMiBPerHour: this.rssSlopeMiBPerHour(),
      fdCountFirst: this.fdSamples[0]?.fdCount ?? null,
      fdCountLast: this.fdSamples[this.fdSamples.length - 1]?.fdCount ?? null,
      fdSlopePerHour: this.fdSlopePerHour()
    }
  }

  // MiB/h slope across the full sample window — only meaningful over a soak
  // long enough to separate signal from noise (template recommends >= 24h
  // for growth/leak claims; short CI soaks are indicative only).
  rssSlopeMiBPerHour () {
    if (this.samples.length < 2) return null
    const first = this.samples[0]
    const last = this.samples[this.samples.length - 1]
    const elapsedHours = (last.t - first.t) / (1000 * 60 * 60)
    if (elapsedHours <= 0) return null
    return (last.rssMiB - first.rssMiB) / elapsedHours
  }

  // Same idea as rssSlopeMiBPerHour but for open file descriptors/sockets —
  // only 2 data points (start/stop), so this is a straight-line rate, not a
  // trend fit; same short-soak caveat applies.
  fdSlopePerHour () {
    if (this.fdSamples.length < 2) return null
    const first = this.fdSamples[0]
    const last = this.fdSamples[this.fdSamples.length - 1]
    const elapsedHours = (last.t - first.t) / (1000 * 60 * 60)
    if (elapsedHours <= 0) return null
    return (last.fdCount - first.fdCount) / elapsedHours
  }
}

module.exports = { percentile, bytesToMiB, dirSizeBytes, ResourceSampler }
