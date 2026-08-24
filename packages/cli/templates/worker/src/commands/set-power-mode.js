'use strict'

const client = require('../client')

module.exports = async (params) => {
  // Example vendor-agnostic-to-firmware translation: this device's API calls
  // low "eco". Adjust to your own device's vocabulary.
  const mode = params.mode === 'low' ? 'eco' : params.mode
  return client.setPowerMode(mode)
}
