'use strict'

const client = require('../client')

module.exports = async () => (await client.getSummary()).board_temp_c
