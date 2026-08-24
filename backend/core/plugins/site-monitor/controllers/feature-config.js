'use strict'

const { config } = require('@tetherto/mdk-gateway/plugin')

module.exports = async function featureConfig (req) {
  return config.featureConfig
}
