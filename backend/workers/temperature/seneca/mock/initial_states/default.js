'use strict'

const { cloneDeep } = require('@bitfinex/lib-js-util-base')
const crypto = require('crypto')

const randomNumber = (min = 0, max = 1) => {
  const randomFl = crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48
  const number = randomFl * (max - min) + min
  return parseFloat(number.toFixed(2))
}

// Baseline reading (30-40C) assumes a modest reference rack venting into this
// sensor's inlet. Scale the baseline up for larger simulated fleets (more
// ASICs exhausting into the same container) so the reading tracks
// ctx.minerCount / `--miners N` instead of always reporting the same fixed
// range regardless of fleet size.
const BASELINE_MINER_NUM = 20
const DEG_C_PER_MINER = 0.15

const baselineRaw = (ctx) => {
  const minerNum = (ctx && ctx.minerCount) || BASELINE_MINER_NUM
  const extraDegC = Math.max(0, minerNum - BASELINE_MINER_NUM) * DEG_C_PER_MINER
  return 300 + Math.round(extraDegC * 10)
}

module.exports = function (ctx) {
  const state = {
    temp: [
      Math.floor(randomNumber() * 100) + baselineRaw(ctx),
      Math.floor(randomNumber() * 100) + baselineRaw(ctx),
      Math.floor(randomNumber() * 100) + baselineRaw(ctx),
      Math.floor(randomNumber() * 100) + baselineRaw(ctx)
    ]
  }

  const buffer = Buffer.alloc(8)

  const getInitialState = () => {
    // random value between baseline and baseline+100
    const newState = cloneDeep(state)
    newState.temp = newState.temp.map(() => ctx?.error ? 8500 : Math.floor(randomNumber() * 100) + baselineRaw(ctx))

    buffer.writeUInt16BE(newState.temp[0], 0)
    buffer.writeUInt16BE(newState.temp[1], 2)
    buffer.writeUInt16BE(newState.temp[2], 4)
    buffer.writeUInt16BE(newState.temp[3], 6)

    Object.assign(state, newState)

    return state
  }

  function bind (connection) {
    connection.on('read-holding-registers', (request, reply) => {
      const address = request.request.address
      const quantity = request.request.quantity
      // only read from 2-5
      if (address < 2 || address > 5) {
        return reply(null, Buffer.from([]))
      } else {
        const offset = (address - 2) * 2
        const length = quantity * 2
        const buf = buffer.subarray(offset, offset + length)
        reply(null, buf)
        // return reply(null, buf)
      }
    })
  }

  // Preserve the initial state for the reset
  const initialState = JSON.parse(JSON.stringify(getInitialState()))

  function cleanup () {
    Object.assign(state, initialState)
    return state
  }

  return { bind, state, cleanup }
}
