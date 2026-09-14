// demo-13.ts：会话与数据底层——可审计、可回放、可检索（真实实现）
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-session         SessionStore：真实会话 + 事件帧 append-only 日志
//   - @deepseek-ai/dsh-session-persistence-jsonl  真实 JSONL 落盘后端（ctx.sessionPersistence）
// 无手写模拟：事件帧写入、持久化、恢复、回放全部走真实机制。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  console.log('=== 会话与数据底层：可审计、可回放、可检索（真实实现）===\n')
  const rootDir = join(process.cwd(), '.demo-13-sessions')
  rmSync(rootDir, { recursive: true, force: true })
  mkdirSync(rootDir, { recursive: true })

  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(JsonlSessionPersistence, { root: rootDir })
  const session = root.sessions.create('audit-demo', { meta: { cwd: process.cwd() } })

  // ========== 1. append-only 事件帧：可审计 ==========
  console.log('--- 1. append-only 事件帧（可审计：谁做了什么全留痕）---')
  session.append('turn/start', { turn: 1 })
  session.append('tool/call', { name: 'fs_read', args: { path: 'config.json' } })
  session.append('command/run', { command: 'cat config.json', cwd: process.cwd() })
  session.append('command/done', { command: 'cat config.json', exit: 0 })
  session.append('tool/call', { name: 'fs_write', args: { path: 'config.json', bytes: 2048 } })
  session.append('turn/end', { turn: 1 })
  const evts = session.snapshotEvents()
  for (const ev of evts) {
    console.log(`  → [seq ${ev.seq}] ${ev.type} ${JSON.stringify(ev.data).slice(0, 130)}`)
  }
  console.log(`  → 审计轨迹 ${evts.length} 帧，append-only（只增不改）`)

  // ========== 2. JSONL 持久化：真实落盘 ==========
  console.log('\n--- 2. 持久化：JSONL 真实落盘 ---')
  const sp = (root as any).sessionPersistence
  const handle = await sp.create(session.header)
  await handle.append(session.snapshotEvents())
  await handle.flush()
  const stat = await sp.stat(session.id)
  console.log(`  → 已落盘: eventCount=${stat?.eventCount}, sizeBytes=${stat?.sizeBytes}`)
  await handle.close()
  const file = join(rootDir, `${session.id}.jsonl`)
  const raw = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []
  console.log(`  → 磁盘文件 ${session.id}.jsonl，共 ${raw.length} 行 JSONL（真实持久化为 zstd 压缩 v3 格式，事件内容经 stat/read 回读）`)
  if (raw.length > 0) console.log(`  → 首行样本: ${raw[0].slice(0, 120)}`)

  // ========== 3. 恢复与回放：可回放 ==========
  console.log('\n--- 3. 恢复与回放（重新 open，事件按 seq 回放）---')
  const h2 = await sp.open(session.id, 'read')
  const readBack = await h2.read()
  console.log(`  → 恢复事件数 = ${readBack.events.length}`)
  const replay = readBack.events.map(e => `${e.seq}:${e.type}`).join(' | ')
  console.log(`  → 回放轨迹 = ${replay}`)
  await h2.close()

  // ========== 4. 检索：可检索 ==========
  console.log('\n--- 4. 检索（按事件类型/关键词过滤事件流）---')
  const toolCalls = readBack.events.filter(e => e.type === 'tool/call')
  console.log(`  → 类型检索：tool/call 共 ${toolCalls.length} 条，工具列表=${toolCalls.map(e => (e.data as any).name).join(',')}`)
  const fsWrites = readBack.events.filter(e => JSON.stringify(e.data).includes('fs_write'))
  console.log(`  → 内容检索：含 fs_write 的事件 ${fsWrites.length} 条，路径=${(fsWrites[0]?.data as any)?.args?.path}`)

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
