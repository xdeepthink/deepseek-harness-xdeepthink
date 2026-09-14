// mcp-server.mjs：最小 MCP stdio 服务器（真实 JSON-RPC over stdio）
// 供 dsh-mcp-client 连接。实现 initialize / tools/list / tools/call。
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

const TOOLS = [
  {
    name: 'echo',
    description: '原样返回输入文本',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'add',
    description: '计算两个整数之和',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
]

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}
function respondError(id, error) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error }) + '\n')
}

rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.method === 'initialize') {
    respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'demo-mcp-server', version: '1.0.0' } })
  } else if (msg.method === 'notifications/initialized') {
    // 通知，无响应
  } else if (msg.method === 'tools/list') {
    respond(msg.id, { tools: TOOLS })
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params
    if (name === 'echo') {
      respond(msg.id, { content: [{ type: 'text', text: String(args.text) }], isError: false })
    } else if (name === 'add') {
      const sum = Number(args.a) + Number(args.b)
      respond(msg.id, { content: [{ type: 'text', text: String(sum) }], isError: false })
    } else {
      respondError(msg.id, { code: -32601, message: `unknown tool: ${name}` })
    }
  } else {
    respondError(msg.id, { code: -32601, message: `unknown method: ${msg.method}` })
  }
})
