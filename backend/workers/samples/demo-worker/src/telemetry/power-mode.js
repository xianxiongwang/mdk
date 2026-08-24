'use strict'

const client = require('../client')

module.exports = async () => (await client.getSummary()).power_mode
