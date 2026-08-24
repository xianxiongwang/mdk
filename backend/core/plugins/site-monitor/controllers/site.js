'use strict'

const { config } = require('@tetherto/mdk-gateway/plugin')

module.exports = async function site (req) {
  return { site: config.site }
}
