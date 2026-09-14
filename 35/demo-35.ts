// demo-35.ts：session（会话管理与多会话隔离）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-session                  SessionStore（ctx.sessions）+ Session 事件日志
//   - @deepseek-ai/dsh-session-projection       SessionProjectionRegistry（todos 投影折叠）
//   - @deepseek-ai/dsh-session-persistence      持久化服务定义（ctx.sessionPersistence）
//   - @deepseek-ai/dsh-session-persistence-jsonl JSONL 真实落盘后端
//   - @deepseek-ai/dsh-system-prompt / dsh-tools 工具管道
// 全程不手写模拟类：会话创建、事件追加、多会话隔离、投影折叠、持久化与恢复全部由 dsh 真实代码完成。
import * as fs from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, Session } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { apply as applyTodo } from '@deepseek-ai/dsh-tool-todo'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'

// ---------- 装配最小 dsh 运行时 ----------
async function assemble(rootDir: string) {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(JsonlSessionPersistence, { root: rootDir })
  applyTodo(root, {}) // 注册 todos 投影单元（todos 折叠视图）+ todo_write 工具
  console.log(`[装配] sessions=${typeof root.sessions.create}, sessionPersistence=${typeof (root as any).sessionPersistence?.create}`)
  return root
}

// ---------- 演示 ----------
async function main() {
  console.log('=== dsh session：会话管理与多会话隔离（真实实现）===\n')
  const rootDir = process.cwd() + '/.demo-35-sessions'
  fs.rmSync(rootDir, { recursive: true, force: true }) // 清掉上次运行的 jsonl，保证脚本可重复执行
  const ctx = await assemble(rootDir)

  // ========== 1. 创建两个会话（多会话） ==========
  console.log('--- 1. 创建会话 A / B（多会话并存）---')
  const sessionA = ctx.sessions.create('session-demo-a', { meta: { cwd: process.cwd() } })
  const sessionB = ctx.sessions.create('session-demo-b', { meta: { cwd: process.cwd() } })
  console.log(`  → A: id=${sessionA.id}, header.version=${sessionA.header.version}`)
  console.log(`  → B: id=${sessionB.id}`)

  // ========== 2. 会话 A：追加事件（append-only 日志） ==========
  console.log('\n--- 2. 会话 A 追加事件（turn/start → 消息 → todo/write → turn/end）---')
  sessionA.append('turn/start', { turn: 1 })
  sessionA.append('user/message', createUserMessage({ role: 'user', content: [{ type: 'text', text: '帮我确认功能列表' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const assistantMsg = createAssistantMessage({ role: 'assistant', content: [{ type: 'text', text: '好的，我来拆解待办' }], source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } })
  sessionA.append('assistant/message', { message: assistantMsg, turn: 0, step: 0, stream: [] }, { surfaceOp: 'append' })
  sessionA.append('todo/write', { todos: [{ content: '确认功能列表', status: 'in_progress' }, { content: '输出需求文档', status: 'pending' }] })
  sessionA.append('turn/end', { turn: 1 })

  // ========== 3. 会话 B：追加自己的事件 ==========
  console.log('\n--- 3. 会话 B 追加事件（与 A 完全独立）---')
  sessionB.append('turn/start', { turn: 1 })
  sessionB.append('user/message', createUserMessage({ role: 'user', content: [{ type: 'text', text: '帮我查一下数据库表设计' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  sessionB.append('todo/write', { todos: [{ content: '设计 users 表', status: 'in_progress' }] })
  sessionB.append('turn/end', { turn: 1 })

  // ========== 4. 多会话隔离验证 ==========
  console.log('\n--- 4. 多会话隔离：事件日志与投影互不干扰 ---')
  console.log(`  → A 事件数 = ${sessionA.snapshotEvents().length}, B 事件数 = ${sessionB.snapshotEvents().length}`)
  const todosA = (ctx as any).sessionProjections.snapshot(sessionA, ['todos']).values.todos
  const todosB = (ctx as any).sessionProjections.snapshot(sessionB, ['todos']).values.todos
  console.log(`  → A 的 todos 投影: ${JSON.stringify(todosA)}`)
  console.log(`  → B 的 todos 投影: ${JSON.stringify(todosB)}`)
  console.log(`  → A 不含 B 的 todo = ${!JSON.stringify(todosA).includes('users 表')}, B 不含 A 的 todo = ${!JSON.stringify(todosB).includes('需求文档')}`)

  // ========== 5. 持久化：JSONL 落盘 ==========
  console.log('\n--- 5. 持久化会话 A（JSONL 真实落盘）---')
  const sp = (ctx as any).sessionPersistence
  const handleA = await sp.create(sessionA.header)
  await handleA.append(sessionA.snapshotEvents())
  await handleA.flush()
  const statA = await sp.stat(sessionA.id)
  console.log(`  → 已落盘: eventCount=${statA?.eventCount ?? '?'}, sizeBytes=${statA?.sizeBytes ?? '?'}`)
  await handleA.close()

  // ========== 6. 恢复：重新打开持久化会话 ==========
  console.log('\n--- 6. 恢复：重新 open 会话 A 并读取事件 ---')
  const handleA2 = await sp.open(sessionA.id, 'read')
  const readA = await handleA2.read()
  console.log(`  → 恢复事件数 = ${readA.events.length}`)
  for (const ev of readA.events.slice(0, 5)) {
    console.log(`    seq=${ev.seq} ${ev.type}`)
  }
  await handleA2.close()

  // ========== 7. fork：从会话 A 派生分叉会话 ==========
  console.log('\n--- 7. fork：从 A 的事件日志派生分叉会话（seed 回放）---')
  const forkA2 = Session.create('session-demo-a-fork', sessionA.snapshotEvents())
  console.log(`  → fork 会话 id=${forkA2.id}, 继承事件数=${forkA2.snapshotEvents().length}`)
  forkA2.append('user/message', createUserMessage({ role: 'user', content: [{ type: 'text', text: '在 fork 里补充一个需求' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  console.log(`  → fork 追加后事件数=${forkA2.snapshotEvents().length}（原会话 A 仍是 ${sessionA.snapshotEvents().length}，互不影响）`)

  // ========== 8. 事件日志回放（A 的完整轨迹） ==========
  console.log('\n--- 8. 会话 A 完整事件日志（append-only，可回放）---')
  for (const ev of sessionA.snapshotEvents()) {
    console.log(`seq=${ev.seq} ${ev.type} data=${JSON.stringify(ev.data).slice(0, 100)}`)
  }

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
