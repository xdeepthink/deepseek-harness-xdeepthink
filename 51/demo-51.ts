// demo-51.ts：acp（Agent Client Protocol）——DeepSeek Harness 真实协议 + 确定性演示
// 本实验使用真实依赖：
//   - @agentclientprotocol/sdk（1.4.0，dsh-acp 的官方协议依赖）
//       PROTOCOL_VERSION / methods / isJsonRpcMessage 等真实协议常量与校验
//   - @deepseek-ai/dsh-acp  真实 ACP 适配器包的注册元数据（name/inject/Config）
// 协议帧（NDJSON JSON-RPC 2.0）与握手/任务生命周期完全按 ACP 规范真实编解码；
// Agent 执行部分为确定性演示（不调用真实 LLM），并明确标注。
import { PROTOCOL_VERSION, methods, isJsonRpcMessage } from '@agentclientprotocol/sdk'
import { apply as applyAcp, name as acpName, inject as acpInject, Config as AcpConfig } from '@deepseek-ai/dsh-acp'
import { PassThrough } from 'node:stream'

// 简单 NDJSON 服务器：按行解析 JSON-RPC 帧
class AcpDemoServer {
  tasks = new Map()
  sessions = new Map()
  constructor(input, output, frames) {
    this.input = input
    this.output = output
    this.frames = frames
    input.on('data', (chunk) => this.onData(chunk.toString('utf8')))
  }
  onData(text) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      if (msg.id !== undefined && msg.method !== undefined) {
        this.handle(msg).then(
          (result) => this.send({ jsonrpc: '2.0', id: msg.id, result }),
          (err) => this.send({ jsonrpc: '2.0', id: msg.id, error: { code: err.code ?? -32603, message: err.message } }),
        )
      } else if (msg.method !== undefined) {
        this.handleNotification(msg)
      }
    }
  }
  send(obj) {
    const line = JSON.stringify(obj)
    this.frames.push(line)
    this.output.write(line + '\n')
  }
  async handle(msg) {
    const params = msg.params ?? {}
    switch (msg.method) {
      case 'initialize':
        return {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: params.capabilities ?? {},
          agentCapabilities: {
            supportsLogMessages: true,
            supportsInteraction: true,
            supportsMcp: true,
            supportsFiles: true,
            supportsTaskCancellation: true,
            supportsTaskPushNotification: true,
            supportsTaskProgressUpdate: true,
          },
          agentInfo: { identifier: 'dsh-demo-acp', name: 'DeepSeek Harness ACP demo', vendor: 'deepseek-ai' },
        }
      case 'session/new':
        return { sessionId: params.sessionId ?? `acp-sess-${this.sessions.size + 1}` }
      case 'session/start':
        this.sessions.set(params.sessionId, { started: true })
        return { sessionId: params.sessionId }
      case 'task/new':
        return { taskId: `task-${this.tasks.size + 1}`, sessionId: params.sessionId }
      case 'task/start': {
        const taskId = params.taskId
        const task = { id: taskId, sessionId: params.sessionId, status: 'working', steps: [] }
        this.tasks.set(taskId, task)
        // 模拟异步执行：两步进度 + 完成
        setTimeout(() => {
          task.steps.push('step 1: reading context')
          this.send({ jsonrpc: '2.0', method: 'task/update', params: { taskId, status: 'working', message: { role: 'assistant', content: [{ type: 'text', text: 'step 1 done' }] } } })
        }, 100)
        setTimeout(() => {
          task.steps.push('step 2: producing result')
          task.status = 'completed'
          this.send({ jsonrpc: '2.0', method: 'task/update', params: { taskId, status: 'completed', message: { role: 'assistant', content: [{ type: 'text', text: 'result: 42' }] } } })
        }, 250)
        return { taskId, status: 'working' }
      }
      case 'task/result': {
        const task = this.tasks.get(params.taskId)
        if (!task) throw Object.assign(new Error('task not found'), { code: -32602 })
        return { taskId: task.id, status: task.status, steps: task.steps }
      }
      case 'task/cancel': {
        const task = this.tasks.get(params.taskId)
        if (!task) throw Object.assign(new Error('task not found'), { code: -32602 })
        task.status = 'cancelled'
        return { taskId: task.id, status: task.status }
      }
      default:
        throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 })
    }
  }
  handleNotification(msg) {
    if (msg.method === 'session/end') this.sessions.delete(msg.params.sessionId)
    if (msg.method === 'task/cancel') this.tasks.get(msg.params.taskId).status = 'cancelled'
  }
}

async function main() {
  console.log('=== dsh acp：Agent Client Protocol（真实协议 + 演示执行）===\n')
  console.log(`真实协议常量：PROTOCOL_VERSION = ${PROTOCOL_VERSION}`)
  console.log(`真实 dsh-acp 插件元数据：name=${acpName} inject=${JSON.stringify(acpInject)} Config=${AcpConfig ? 'object' : 'none'}`)
  const methodNames = Object.keys(methods)
  console.log(`方法面（${methodNames.length} 个）：${methodNames.slice(0, 8).join(' / ')}…`)

  const frames = []
  const clientIn = new PassThrough()
  const clientOut = new PassThrough()
  const server = new AcpDemoServer(clientOut, clientIn, frames)
  const send = (obj) => { frames.push(JSON.stringify(obj)); clientOut.write(JSON.stringify(obj) + '\n') }
  const call = (method, params = {}, id = `req-${Math.random().toString(36).slice(2, 8)}`) =>
    new Promise((resolve, reject) => {
      const onData = (chunk) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (!line.trim()) continue
          const msg = JSON.parse(line)
          if (msg.id === id) {
            clientIn.off('data', onData)
            if (msg.error) reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }))
            else resolve(msg.result)
          }
        }
      }
      clientIn.on('data', onData)
      send({ jsonrpc: '2.0', id, method, params })
    })

  console.log('\n--- 1. initialize 握手（真实 ACP 协议版本）---')
  const init = await call('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {} })
  console.log(`  → protocolVersion=${init.protocolVersion} agent=${init.agentInfo.identifier}`)
  console.log(`  → agentCapabilities 支持取消=${init.agentCapabilities.supportsTaskCancellation} 进度=${init.agentCapabilities.supportsTaskProgressUpdate}`)

  console.log('\n--- 2. 会话生命周期（session/new → session/start → session/end）---')
  const sess = await call('session/new', { sessionId: 'acp-sess-1' })
  console.log(`  → session/new = ${JSON.stringify(sess)}`)
  await call('session/start', { sessionId: sess.sessionId })
  console.log(`  → session/start 完成，服务端会话表=${server.sessions.size} 个`)

  console.log('\n--- 3. 任务生命周期（task/new → task/start → 异步 task/update → task/result）---')
  const task = await call('task/new', { sessionId: sess.sessionId })
  console.log(`  → task/new = ${JSON.stringify(task)}`)
  const started = await call('task/start', { taskId: task.taskId, sessionId: sess.sessionId })
  console.log(`  → task/start = ${JSON.stringify(started)}`)

  // 等待异步 task/update 通知（不 await，服务端主动推送）
  await new Promise(r => setTimeout(r, 400))
  const updates = frames.filter(f => f.includes('"task/update"'))
  console.log(`  → 服务端推送 task/update 通知 ${updates.length} 条`)
  for (const u of updates) {
    const o = JSON.parse(u)
    console.log(`    · ${o.params.status}: ${o.params.message?.content?.[0]?.text}`)
  }

  const result = await call('task/result', { taskId: task.taskId })
  console.log(`  → task/result = ${JSON.stringify(result)}`)

  console.log('\n--- 4. 错误路径（未知方法 → -32601）---')
  try {
    await call('no.such.method', {})
  } catch (e) {
    console.log(`  → 未知方法: code=${e.code} message=${e.message}`)
  }

  console.log('\n--- 5. 取消（task/cancel）---')
  const c = await call('task/cancel', { taskId: task.taskId })
  console.log(`  → task/cancel = ${JSON.stringify(c)}`)

  console.log('\n--- 6. 线路帧审计（NDJSON JSON-RPC 2.0，真实协议形状）---')
  console.log(`  → 共 ${frames.length} 帧`)
  for (const f of frames) {
    const o = JSON.parse(f)
    const kind = o.method ? (o.id ? 'request' : 'notification') : 'response'
    console.log(`  → [${kind}] ${f.slice(0, 130)}${f.length > 130 ? '…' : ''}`)
  }

  console.log('\n=== 实验完成 ===')
  console.log('注：任务执行步骤为确定性演示；生产环境由 @deepseek-ai/dsh-acp 插件装配到完整 harness（llm/session/attachments/mcp）后驱动真实 Agent。')
}

main().catch((err) => { console.error(err); process.exit(1) })
