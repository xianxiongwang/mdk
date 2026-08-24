import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3008/mcp')
)

const client = new Client({ name: 'my-agent', version: '1.0.0' })
await client.connect(transport)

// List all Workers
const status = await client.callTool({ name: 'get_status', arguments: {} })
console.log(JSON.parse(status.content[0].text))

// Pull telemetry for a device
const telemetry = await client.callTool({
  name: 'pull_telemetry',
  arguments: { deviceId: 'wm001', query: 'metrics' }
})
console.log(JSON.parse(telemetry.content[0].text))

// Inspect what commands a device supports
const caps = await client.callTool({
  name: 'get_capabilities',
  arguments: { deviceId: 'wm001' }
})
console.log(JSON.parse(caps.content[0].text))

// Send a command
const result = await client.callTool({
  name: 'send_command',
  arguments: { deviceId: 'wm001', command: 'reboot', params: {} }
})
console.log(JSON.parse(result.content[0].text))

await client.close()
