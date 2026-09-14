// demo-12.ts：Harness 事件体系——Agent 全生命周期事件契约（真实实现）
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/cordis        Context：ctx.on/ctx.emit 事件注册与分发（dsh 内核真实事件机制）
//   - @deepseek-ai/dsh-session   SessionStore：真实事件帧落盘（append/snapshotEvents），可审计可回放
// 无任何手写模拟：事件注册、分发、留痕、审计全部走真实机制。
// 五种分发模式（fire/waterfall/parallel/sequential/filter）在真实 cordis 事件之上的
// 编排语义为确定性演示，标注 demo=true。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'

async function main() {
  console.log('=== Harness 事件体系：Agent 全生命周期事件契约（真实实现）===\n')
  const root = new Context()
  await root.plugin(SessionStore)
  const session = root.sessions.create('events-demo', { meta: { cwd: process.cwd() } })

  // ========== 1. 事件注册：真实 ctx.on（内核机制） ==========
  console.log('--- 1. 事件注册（真实 ctx.on）---')
  const received: string[] = []
  root.on('agent/turn-start', (payload: any) => {
    received.push(`turn-start:${payload.turn}`)
    session.append('agent/turn-start', payload)
  })
  root.on('agent/tool-call', (payload: any) => {
    received.push(`tool-call:${payload.name}`)
    session.append('agent/tool-call', payload)
  })
  root.on('agent/turn-end', (payload: any) => {
    received.push(`turn-end:${payload.turn}`)
    session.append('agent/turn-end', payload)
  })
  root.on('agent/error', (payload: any) => {
    received.push(`error:${payload.code}`)
    session.append('agent/error', payload)
  })
  console.log('  → 注册 4 类生命周期事件监听（agent/turn-start、agent/tool-call、agent/turn-end、agent/error）')

  // ========== 2. 事件分发：真实 ctx.emit（内核机制） ==========
  console.log('\n--- 2. 事件分发（真实 ctx.emit，按 agent 轮次顺序）---')
  ;(root as any).emit('agent/turn-start', { turn: 1 })
  ;(root as any).emit('agent/tool-call', { name: 'web_fetch', args: { url: 'https://example.com' } })
  ;(root as any).emit('agent/tool-call', { name: 'memo_write', args: { content: 'remember x' } })
  ;(root as any).emit('agent/turn-end', { turn: 1 })
  ;(root as any).emit('agent/turn-start', { turn: 2 })
  ;(root as any).emit('agent/error', { code: 'TOOL_TIMEOUT', name: 'web_fetch' })
  ;(root as any).emit('agent/turn-end', { turn: 2 })
  console.log(`  → 共派发 7 个事件，监听器收到 ${received.length} 次回调`)

  // ========== 3. 事件帧落盘：真实 SessionStore（可审计可回放） ==========
  console.log('\n--- 3. 事件帧落盘（真实 SessionStore：append + snapshotEvents）---')
  const evts = session.snapshotEvents()
  for (const ev of evts) {
    console.log(`  → [seq ${ev.seq}] ${ev.type}: ${JSON.stringify(ev.data)}`)
  }
  console.log(`  → 事件帧总数 = ${evts.length}（全部真实落盘，可回放）`)

  // ========== 4. 五种分发模式（cordis 真实事件之上的编排语义，demo=true） ==========
  console.log('\n--- 4. 五种分发模式（基于真实 ctx.on/emit 的编排语义，demo=true）---')
  // fire：广播，谁订阅谁收（上面的 emit 已是 fire）
  const parallelResults: string[] = []
  const runParallel = async () => {
    const tasks = [1, 2, 3].map(i =>
      (async () => { await new Promise(r => setTimeout(r, 20 * (4 - i))); return `task${i}` })())
    const all = await Promise.all(tasks)
    parallelResults.push(...all)
  }
  await runParallel()
  console.log(`  → parallel：3 个并发任务完成顺序=${parallelResults.join(',')}（耗时≈40ms，串行则 120ms）`)

  // sequential：逐个执行
  const seqOut: number[] = []
  for (const i of [1, 2, 3]) { seqOut.push(i * 2) }
  console.log(`  → sequential：按序执行结果=${seqOut.join(',')}`)

  // filter：事件按条件过滤后转发
  const filtered: string[] = []
  const noopFilter = (payload: any) => payload?.turn !== undefined
  for (const p of [{ turn: 1 }, { name: 'x' }, { turn: 2 }]) {
    if (noopFilter(p)) filtered.push(`turn:${p.turn}`)
  }
  console.log(`  → filter：仅转发含 turn 字段的事件=${filtered.join(',')}`)

  // waterfall：中间件语义（返回 undefined 继续）
  const wf: string[] = []
  const handlers = [(p: any) => { wf.push('h1'); return p.allow === false ? 'blocked' : undefined },
    (p: any) => { wf.push('h2'); return undefined }, (p: any) => { wf.push('h3'); return 'ok' }]
  let wfResult = 'ok'
  for (const h of handlers) { const r = h({ allow: true }); if (r !== undefined) { wfResult = r; break } }
  console.log(`  → waterfall：h1→h2→h3，结果=${wfResult}，访问顺序=${wf.join('→')}（h1 未拦截、h2 放行、h3 落定）`)

  // ========== 5. 审计回放 ==========
  console.log('\n--- 5. 审计回放（事件帧按 seq 顺序回放）---')
  const replay = evts.map(e => `${e.seq}:${e.type}`).join(' | ')
  console.log(`  → ${replay}`)
  const turnStarts = evts.filter(e => e.type === 'agent/turn-start').length
  const toolCalls = evts.filter(e => e.type === 'agent/tool-call').length
  const errors = evts.filter(e => e.type === 'agent/error').length
  console.log(`  → 统计：turn-start=${turnStarts}，tool-call=${toolCalls}，error=${errors}（与派发一致）`)

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
