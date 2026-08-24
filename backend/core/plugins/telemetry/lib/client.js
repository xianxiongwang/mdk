'use strict'

const { config } = require('@tetherto/mdk-gateway/plugin')
const { createMdkClient } = require('@tetherto/mdk-client')

module.exports = createMdkClient(config)
