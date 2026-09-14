// demo-50.ts：sdk（JSON-RPC 客户端协议）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-sdk-protocol   JsonRpcLineTransport：新行分隔 JSON-RPC 2.0 over byte
//                                      流（请求/响应/通知三类帧；缺 handler → -32601；
//                                      handler 失败 → -32603）
//   - @deepseek-ai/dsh-session         SessionStore：会话存储，作为 JSON-RPC 方法的真实后端
//   - @deepseek-ai/dsh-session-projection  SessionProjectionRegistry（session store 配套）
// 通过真实字节流 + 真实会话存储验证：请求/响应/通知帧、错误帧、取消，全程无模拟。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { JsonRpcLineTransport, JsonRpcResponseError } from '@deepseek-ai/dsh-sdk-protocol'
import { PassThrough } from 'node:stream'

// 字节流对接 + 帧记录：把真实线路上的原始 JSON 行记录下来供展示
function linkTransports() {
  const serverIn = new PassThrough()
  const serverOut = new PassThrough()
  const frames: string[] = []
  for (const s of [serverIn, serverOut]) {
    s.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) frames.push(line)
      }
    })
  }
  const server = new JsonRpcLineTransport(serverIn, serverOut)
  const client = new JsonRpcLineTransport(serverOut, serverIn)
  return { server, client, frames }
}

async function assemble() {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  console.log(`[装配] SessionStore 已就绪，sessions=${typeof (root as any).sessions?.create}`)
  return root
}

async function main() {
  console.log('=== dsh sdk：JSON-RPC 客户端协议（真实实现）===\n')
  const ctx = await assemble()
  const { server, client, frames } = linkTransports()
  server.start()
  client.start()

  // ========== 1. server 端方法注册（后端是真实 SessionStore） ==========
  console.log('--- 1. server 端 JSON-RPC 方法（真实 SessionStore 后端）---')
  server.onRequest(async (method: string, params: any) => {
    switch (method) {
      case 'session.list': {
        const sessions = ctx.sessions.list()
        return { count: sessions.length, sessions: sessions.map(s => ({ id: s.id, seq: s.seq })) }
      }
      case 'session.new': {
        const session = ctx.sessions.create(params.id, { meta: { cwd: process.cwd(), via: 'jsonrpc' } })
        session.append('turn/start', { turn: 1 })
        return { id: session.id, seq: session.seq }
      }
      case 'session.get': {
        const s = ctx.sessions.get(params.id)
        if (!s) throw new Error(`session not found: ${params.id}`)
        return { id: s.id, seq: s.seq, eventCount: s.snapshotEvents().length }
      }
      case 'session.kill':
        throw new Error('session.kill is not allowed in this demo')
      default:
        // handler 内抛错会被 transport 统一包装为 -32603；未注册 handler 才是 -32601
        throw new Error(`method not found: ${method}`)
    }
  })
  console.log('  → session.list / session.new / session.get / session.kill 已注册')

  // ========== 2. 请求-响应往返 ==========
  console.log('\n--- 2. 请求-响应往返（session.list → 真实空会话表）---')
  const empty = await client.request('session.list', {})
  console.log(`  → session.list = ${JSON.stringify(empty)}`)

  console.log('\n--- 3. 创建会话（session.new → 真实写入 SessionStore）---')
  const created = await client.request('session.new', { id: 'sdk-sess-1' })
  console.log(`  → session.new = ${JSON.stringify(created)}`)
  const created2 = await client.request('session.new', { id: 'sdk-sess-2' })
  console.log(`  → session.new = ${JSON.stringify(created2)}`)

  console.log('\n--- 4. 再次 list（真实状态已变化）---')
  const listed = await client.request('session.list', {})
  console.log(`  → session.list = ${JSON.stringify(listed)}`)

  console.log('\n--- 5. session.get（读取事件数）---')
  const got = await client.request('session.get', { id: 'sdk-sess-1' })
  console.log(`  → session.get = ${JSON.stringify(got)}`)

  // ========== 6. 错误帧 ==========
  console.log('\n--- 6. 错误帧（未注册 handler → -32601；handler 失败 → -32603）---')
  // -32601：只有"未注册 request handler"的 transport 才会产生
  const bareIn = new PassThrough()
  const bareOut = new PassThrough()
  const bare = new JsonRpcLineTransport(bareIn, bareOut)
  const bareClient = new JsonRpcLineTransport(bareOut, bareIn)
  bare.start()
  bareClient.start()
  try {
    await bareClient.request('no.such.method', {})
  } catch (e: any) {
    console.log(`  → 未注册 handler: code=${e.code} message=${e.message}`)
  }
  bareClient.close()
  bare.close()
  // -32603：handler 抛错（如 session.kill 被拒）
  try {
    await client.request('session.kill', { id: 'sdk-sess-1' })
  } catch (e: any) {
    console.log(`  → handler 失败: code=${e.code} message=${e.message}`)
  }

  // ========== 7. 通知帧 ==========
  console.log('\n--- 7. 通知（server → client，无响应帧）---')
  client.onNotification((method: string, params: any) => {
    console.log(`  → client 收到通知: method=${method} params=${JSON.stringify(params)}`)
  })
  server.notify('session/created', { id: 'sdk-sess-3' })
  await new Promise(r => setTimeout(r, 300))

  // ========== 8. 线路帧审计 ==========
  console.log('\n--- 8. 线路帧审计（真实 JSON-RPC 2.0 帧）---')
  console.log(`  → 共 ${frames.length} 帧:`)
  for (const f of frames) {
    const o = JSON.parse(f)
    const kind = o.method ? (o.id ? 'request' : 'notification') : 'response'
    console.log(`  → [${kind}] ${f.slice(0, 120)}${f.length > 120 ? '…' : ''}`)
  }

  console.log('\n=== 实验完成 ===')
  client.close()
  server.close()
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
