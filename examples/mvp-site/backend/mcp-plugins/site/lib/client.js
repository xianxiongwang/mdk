'use strict'

const { config } = require('@tetherto/mdk-mcp/plugin')
const { createMdkClient } = require('@tetherto/mdk-client')

module.exports = createMdkClient(config)
