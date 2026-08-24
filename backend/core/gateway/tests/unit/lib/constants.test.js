'use strict'

const test = require('brittle')
const constants = require('../../../workers/lib/constants')
const { RPC_TIMEOUT } = constants

test('constants - RPC_TIMEOUT', (t) => {
  t.is(RPC_TIMEOUT, 15000, 'should be 15000 milliseconds')
  t.ok(typeof RPC_TIMEOUT === 'number', 'should be number')
  t.ok(RPC_TIMEOUT > 0, 'should be positive')
})

test('constants - exports only the RPC constants', (t) => {
  t.alike(
    Object.keys(constants).sort(),
    ['RPC_TIMEOUT'],
    'should export exactly the RPC timeout'
  )
})
