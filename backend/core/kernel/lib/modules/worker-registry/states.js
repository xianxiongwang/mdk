'use strict'

/**
 * Worker Registry State Machine
 *
 * UNREGISTERED → DISCOVERED → IDENTITY_SAVED → READY → TERMINATED
 *
 * - UNREGISTERED: declared in the transition table only; never assigned at runtime
 * - DISCOVERED: assigned by recover() to a persisted Worker awaiting reconnect
 * - IDENTITY_SAVED: assigned by register(); identity.response received, devices mapped
 * - READY: assigned by setReady(); capability.response received, fully operational
 * - TERMINATED: declared in the transition table only; terminate() deletes the
 *   registry entry outright rather than assigning this state
 *
 * The live DHT path is register() → setReady(), i.e. IDENTITY_SAVED → READY.
 */

const REGISTRY_STATES = {
  UNREGISTERED: 'UNREGISTERED',
  DISCOVERED: 'DISCOVERED',
  IDENTITY_SAVED: 'IDENTITY_SAVED',
  READY: 'READY',
  TERMINATED: 'TERMINATED'
}

/**
 * Valid state transitions
 */
const REGISTRY_TRANSITIONS = {
  [REGISTRY_STATES.UNREGISTERED]: [REGISTRY_STATES.DISCOVERED],
  [REGISTRY_STATES.DISCOVERED]: [REGISTRY_STATES.IDENTITY_SAVED, REGISTRY_STATES.TERMINATED],
  [REGISTRY_STATES.IDENTITY_SAVED]: [REGISTRY_STATES.READY, REGISTRY_STATES.TERMINATED],
  [REGISTRY_STATES.READY]: [REGISTRY_STATES.TERMINATED],
  [REGISTRY_STATES.TERMINATED]: []
}

function isValidTransition (from, to) {
  const allowed = REGISTRY_TRANSITIONS[from]
  return allowed ? allowed.includes(to) : false
}

module.exports = {
  REGISTRY_STATES,
  REGISTRY_TRANSITIONS,
  isValidTransition
}
