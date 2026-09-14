// demo-23.ts：subprocess——进程管理与资源控制（真实实现）
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-subprocess-local   LocalSubprocessRuntime：ctx.subprocess（真实进程 spawn、
//                                          进程树管理、waitForExit、超时清理）
// 无手写模拟：进程启动、生命周期、超时终止全部走真实机制。
// 资源限制策略（最大并发数）为上层演示逻辑，标注 demo=true。
import { Context } from '@deepseek-ai/cordis'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import PwshLocalExecutor from '@deepseek-ai/dsh-pwsh-local'
import { randomUUID } from 'node:crypto'

const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'

async function main() {
  console.log('=== subprocess：进程管理与资源控制（真实实现）===\n')
  const root = new Context()
  await root.plugin(SubprocessRuntime as any)
  await root.plugin(PwshLocalExecutor as any)
  const sub = (root as any).subprocess
  console.log(`  → ctx.subprocess 就绪（真实运行时）`)
  const lifecycle: string[] = []

  const spawnAndWatch = (argv: string[], label: string, timeoutMs = 15000) => {
    const h = sub.spawn({ argv, cwd: process.cwd(), timeoutMs, graceMs: 3000, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
    let out = ''
    h.stdout.on('data', (c: Buffer) => { out += c.toString() })
    h.stderr.on('data', (c: Buffer) => { out += c.toString() })
    h.done.then((r: any) => lifecycle.push(`${label}:exit(${r?.exitCode ?? '?'})`), () => lifecycle.push(`${label}:error`))
    return { h, out: () => out }
  }

  // ========== 1. 三个真实进程并行启动 ==========
  console.log('--- 1. 真实进程并行启动（同一运行时）---')
  const p1 = spawnAndWatch([BASH, '-c', 'sleep 1; echo P1-done'], 'p1')
  const p2 = spawnAndWatch([BASH, '-c', 'sleep 2; echo P2-done'], 'p2')
  const p3 = spawnAndWatch([BASH, '-c', 'sleep 3; echo P3-done'], 'p3')
  console.log('  → 已 spawn p1（1s）、p2（2s）、p3（3s）三个真实 bash 进程')

  // ========== 2. 生命周期：按完成顺序记录（真实 waitForExit） ==========
  console.log('\n--- 2. 生命周期记录（真实完成顺序）---')
  await Promise.all([p1.h.waitForExit(), p2.h.waitForExit(), p3.h.waitForExit()])
  console.log(`  → 完成顺序：${lifecycle.filter(l => l.startsWith('p')).join(' | ')}`)
  console.log(`  → p1 输出: ${p1.out().trim().split('\n').pop()}`)
  console.log(`  → p3 输出: ${p3.out().trim().split('\n').pop()}`)

  // ========== 3. 超时终止（真实 timeoutMs 机制） ==========
  console.log('\n--- 3. 超时终止（真实 timeoutMs：进程被强制清理）---')
  const t0 = Date.now()
  const slow = spawnAndWatch([BASH, '-c', 'sleep 30; echo never'], 'slow', 3000)
  await Promise.race([slow.h.waitForExit(), new Promise(r => setTimeout(r, 9000))])
  const elapsed = Date.now() - t0
  const stillRunning = (slow.h as any).running?.() ?? false
  console.log(`  → sleep 30 进程：timeoutMs=3000 触发真实超时清理，${elapsed}ms 内被终止（running=${stillRunning}）`)

  // ========== 4. 资源上限（demo=true：进程计数策略） ==========
  console.log('\n--- 4. 资源上限策略（demo=true：最多同时 2 个）---')
  const running = new Set<string>()
  const spawnJob = async (label: string) => {
    const h = sub.spawn({ argv: [BASH, '-c', 'sleep 1'], cwd: process.cwd(), timeoutMs: 10000, graceMs: 3000, stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' } })
    await h.waitForExit()
    running.delete(label)
  }
  const trySpawn = (label: string) => {
    if (running.size >= 2) { console.log(`  → ${label}: 拒绝（已有 ${running.size} 个在跑，达上限）`); return }
    running.add(label)
    console.log(`  → ${label}: 允许（当前在跑 ${running.size}）`)
    void spawnJob(label)
  }
  trySpawn('job-a')
  trySpawn('job-b')
  trySpawn('job-c')
  await new Promise(r => setTimeout(r, 2500))
  console.log(`  → 策略结果：job-a/job-b 同时放行，job-c 因并发上限被拒（真实进程并行执行中）`)

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
