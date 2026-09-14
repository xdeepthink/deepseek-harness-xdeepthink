// demo-25.ts：guard——循环卫生、超时强制与执行安全网（真实实现）
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-timeout   clampTimeout / deadline / idleWatchdog / TimeoutReason / timeoutOf
// 无手写模拟：超时死线、超时原因识别、空闲看门狗、超时钳制全部走真实机制。
// 上层"循环检测策略"（重复调用计数 → 渐进干预）为演示逻辑，标注 demo=true。
import { clampTimeout, deadline, idleWatchdog, TimeoutReason, timeoutOf } from '@deepseek-ai/dsh-timeout'

async function main() {
  console.log('=== guard：循环卫生、超时强制与执行安全网（真实实现）===\n')

  // ========== 1. clampTimeout：请求超时钳制（真实） ==========
  console.log('--- 1. clampTimeout：超时上限钳制（真实）---')
  const maxAllowed = 5000
  const c1 = clampTimeout(30000, 30000, maxAllowed) // 请求 30s → 钳到 5s
  const c2 = clampTimeout(2000, 30000, maxAllowed)  // 请求 2s → 保留 2s
  const c3 = clampTimeout(undefined, 10000, maxAllowed) // 未请求 → 默认 10s 但钳到 5s
  console.log(`  → 请求 30000ms → 实际 ${c1}ms（被上限 5000ms 钳制）`)
  console.log(`  → 请求 2000ms → 实际 ${c2}ms（在限内）`)
  console.log(`  → 未请求（默认 10000ms）→ 实际 ${c3}ms（钳到上限）`)

  // ========== 2. deadline：真实死线强制 ==========
  console.log('\n--- 2. deadline：死线强制（真实 AbortController + TimeoutReason）---')
  const runWithDeadline = async (work: (signal: AbortSignal) => Promise<void>, timeoutMs: number, code: string) => {
    const d = deadline(undefined, timeoutMs, code)
    try {
      await work(d.signal)
      return 'completed'
    } catch (e: any) {
      const carrier = e && 'reason' in e ? e : { reason: e }
      const reason = timeoutOf(carrier, code)
      if (reason) return `timeout(${reason.code}@${reason.timeoutMs}ms)`
      throw e
    } finally {
      d[Symbol.dispose]?.()
    }
  }
  const r1 = await runWithDeadline(async signal => {
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      setTimeout(() => resolve(), 800) // 800ms 完成任务，死线 3000ms
    })
  }, 3000, 'agent-turn')
  console.log(`  → 任务 800ms 完成（死线 3000ms）→ ${r1}`)

  const r2 = await runWithDeadline(async signal => {
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      setTimeout(() => resolve(), 8000) // 8000ms 才完成，死线 1000ms
    })
  }, 1000, 'tool-call')
  console.log(`  → 任务 8000ms 完成（死线 1000ms）→ ${r2}`)

  // ========== 3. timeoutOf：死线原因识别（真实） ==========
  console.log('\n--- 3. timeoutOf：死线原因识别（真实）---')
  const t = new TimeoutReason('tool-call', 1000)
  const viaAbort = AbortSignal.abort(t)
  const matched = timeoutOf(viaAbort, 'tool-call')
  const foreign = timeoutOf(viaAbort, 'agent-turn')
  console.log(`  → abort 携带 TimeoutReason(tool-call@1000ms)；按 code=tool-call 识别 → ${matched ? `命中 ${matched.code}@${matched.timeoutMs}ms` : '未命中'}`)
  console.log(`  → 按 code=agent-turn 识别 → ${foreign ? '误命中' : '未命中（正确区分外层死线）'}`)

  // ========== 4. idleWatchdog：空闲看门狗（真实） ==========
  console.log('\n--- 4. idleWatchdog：空闲看门狗（真实，迭代器空闲超时）---')
  const wd = idleWatchdog(undefined, 600, 'llm-stream-idle')
  const stream = (async function* (signal: AbortSignal) {
    yield 'tick-1'
    await new Promise(r => setTimeout(r, 200))
    yield 'tick-2'
    await new Promise(r => setTimeout(r, 1500)) // 空闲超过 600ms
    if (signal.aborted) throw signal.reason // 迭代器观察信号（真实协议：signal 只通知，工作方自查）
    yield 'tick-3'
  })(wd.signal)
  const seen: string[] = []
  let idleAborted = false
  try {
    for (;;) {
      const { value, done } = await wd.next(stream)
      if (done) break
      seen.push(value)
    }
  } catch (e: any) {
    const carrier = e && 'reason' in e ? e : { reason: e }
    const reason = timeoutOf(carrier, 'llm-stream-idle')
    idleAborted = !!reason
  } finally {
    wd[Symbol.dispose]?.()
  }
  console.log(`  → 流产出 ${JSON.stringify(seen)}，随后空闲 1.5s（看门狗 600ms）→ 中断：${idleAborted}`)

  // ========== 5. 循环检测策略（demo=true） ==========
  console.log('\n--- 5. 循环检测策略（demo=true：重复调用计数 → 渐进干预）---')
  const calls = new Map<string, number>()
  const guard = (tool: string) => {
    const n = (calls.get(tool) ?? 0) + 1
    calls.set(tool, n)
    if (n >= 4) return { action: 'block', note: '第4次重复调用，直接阻断' }
    if (n >= 2) return { action: 'warn', note: `第${n}次重复调用，提示收敛` }
    return { action: 'ok', note: `第${n}次调用` }
  }
  const seq = ['fs_read', 'fs_read', 'fs_read', 'fs_read']
  for (const tool of seq) console.log(`  → ${tool}: ${JSON.stringify(guard(tool))}`)
  console.log('  → 策略（demo）建立在真实超时机制之上：阻断后同一轮调用还会吃真实 deadline')

  console.log('\n=== 实验完成 ===')
}

main().catch((err) => { console.error(err); process.exit(1) })
