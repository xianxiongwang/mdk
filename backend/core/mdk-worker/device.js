'use strict'

/**
 * The ambient per-instance device, required by handler files as
 * `require('@tetherto/mdk-worker/device')` and resolving to that instance's
 * frozen { id, opts, env, config, workerId, logger }.
 *
 * Inside an instance the request never reaches this file: lib/instance-loader.js
 * intercepts it and hands back the device the instance was created with. This
 * file exists to make the specifier resolvable and to fail with a pointer at
 * createInstance() when a plugin module is required outside an instance — a test
 * requiring a handler directly, say — instead of leaving the plugin with
 * `undefined` where its device should be.
 */
throw new Error('ERR_NO_DEVICE_CONTEXT: @tetherto/mdk-worker/device is only available inside a plugin instance; load the plugin with createInstance({ dir, entries, device }) from @tetherto/mdk-worker')
