// demo-45.ts：mcp（MCP 服务器接入）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-mcp-client  MCP client 桥接插件：连接外部 MCP 服务器（stdio），
//                                   工具以 mcp__<serverName>__<rawName> 注册到 ctx.tools
// 配套一个本地真实 MCP stdio 服务器（mcp-server.mjs，JSON-RPC over stdio），全程无模拟。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apply as applyMcpClient, name as mcpClientName, inject as mcpClientInject } from '@deepseek-ai/dsh-mcp-client'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

async function assemble() {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), 'mcp-server.mjs')
  await root.plugin({ name: mcpClientName, inject: mcpClientInject, apply: applyMcpClient }, {
    transport: 'stdio',
    serverName: 'demo',
    command: process.execPath,
    args: [serverPath],
    env: {},
    cwd: process.cwd(),
    toolCallTimeoutMs: 10000,
    failOnStartupError: true,
  })
  console.log(`[装配] MCP 客户端已连接（serverName=demo）`)
  return root
}

async function main() {
  console.log('=== dsh mcp：MCP 服务器接入（真实实现，stdio 传输）===\n')
  const ctx = await assemble()

  // ========== 1. 工具注册验证 ==========
  console.log('--- 1. 工具注册：MCP 工具以 mcp__demo__* 进入 ctx.tools ---')
  const assembly = await ctx.systemPrompt.assemble()
  const mcpTools = assembly.tools.filter(t => t.name.startsWith('mcp__'))
  console.log(`  → MCP 工具: [${mcpTools.map(t => t.name).join(', ')}]`)
  console.log(`  → echo 工具 schema: ${JSON.stringify(mcpTools.find(t => t.name === 'mcp__demo__echo')?.parameters)}`)

  // ========== 2. 创建 agent 会话 ==========
  console.log('\n--- 2. 创建 agent 会话（工具执行上下文）---')
  const session = ctx.sessions.create('mcp-demo', { meta: { cwd: process.cwd() } })
  const agent = { id: session.id, session, ctx } as unknown as Agent

  // ========== 3. 调用 MCP 工具（echo） ==========
  console.log('\n--- 3. 调用 mcp__demo__echo（文本往返）---')
  const echoRes = await ctx.tools.execute({ callId: 'call-mcp-echo', name: 'mcp__demo__echo', arguments: { text: '你好，MCP 服务器！' }, agent, signal: new AbortController().signal })
  console.log(`  → isError=${echoRes.isError}, 结果: ${JSON.stringify(echoRes.value)}`)

  // ========== 4. 调用 MCP 工具（add：参数传递与计算） ==========
  console.log('\n--- 4. 调用 mcp__demo__add（数值计算）---')
  const addRes = await ctx.tools.execute({ callId: 'call-mcp-add', name: 'mcp__demo__add', arguments: { a: 23, b: 19 }, agent, signal: new AbortController().signal })
  console.log(`  → isError=${addRes.isError}, 结果: ${JSON.stringify(addRes.value)}（期望 42）`)

  // ========== 5. 错误路径：未知工具 ==========
  console.log('\n--- 5. 错误路径：调用不存在的 MCP 工具 ---')
  const badRes = await ctx.tools.execute({ callId: 'call-mcp-bad', name: 'mcp__demo__no_such_tool', arguments: {}, agent, signal: new AbortController().signal })
  console.log(`  → isError=${badRes.isError}, 错误: ${JSON.stringify(badRes.error ?? badRes.value).slice(0, 120)}`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
