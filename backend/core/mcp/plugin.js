'use strict'

/**
 * The per-plugin context, required by MCP tool files as
 * `require('@tetherto/mdk-mcp/plugin')` and resolving to that plugin's
 * frozen { config, logger }.
 *
 * Inside a plugin the request never reaches this file: [`./lib/plugin-loader.js`](./lib/plugin-loader.js),
 * the module context the server loads each plugin through, intercepts it
 * and hands back the context the plugin was loaded with. This file exists to
 * make the specifier resolvable and to fail with a pointer at createMcpServer()
 * when a tool module is required outside the server — a test requiring a tool
 * directly, say — instead of leaving the plugin with `undefined` where its
 * context should be.
 */
throw new Error('ERR_NO_PLUGIN_CONTEXT: @tetherto/mdk-mcp/plugin is only available inside an MCP plugin; load the plugin with createMcpServer() or loadPlugin(dir, context) from @tetherto/mdk-mcp')
