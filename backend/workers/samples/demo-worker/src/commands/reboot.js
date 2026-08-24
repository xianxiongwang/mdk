'use strict'

const { id } = require('@tetherto/mdk-worker/device')
const client = require('../client')
const db = require('../db')

module.exports = async () => {
  const result = await client.reboot()
  db.recordCommand(id, 'reboot', {}, result)
  return result
}
