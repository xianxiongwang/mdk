'use strict'

const client = require('../client')

module.exports = async () => (await client.getSummary()).hashrate_ths
