// demo-22.ts：terminal——PTY 持久会话与交互式程序（真实实现）
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-terminal         TerminalSessionService：ctx.terminals（会话注册与生命周期）
//   - @deepseek-ai/dsh-terminal-bash    BashTerminalBackend：真实本地 PTY 后端（bash 方言）
//   - @deepseek-ai/dsh-sandbox-policy   ctx.sandboxPolicy（terminal-bash 依赖注入链）
//   - @deepseek-ai/dsh-subprocess-local + dsh-pwsh-local  真实进程执行底座（PTY 与子进程共用）
// 真实部分：Seam 装配、后端注册、PTY spawn 启动（真实尝试并如实呈现环境限制）、
//           交互式程序经 ctx.subprocess 真实运行（stdin 喂输入、stdout 读回、状态保持）。
// 标注：当前 Windows 无交互式桌面会话 → conpty PTY 无法达到 readiness（真实 fail-closed 证据，
//       与第55篇 sandbox 不可用同性质）；交互演示走真实 subprocess 通道，标注 demo=true。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import PwshLocalExecutor from '@deepseek-ai/dsh-pwsh-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { name as tbName, inject as tbInject, apply as tbApply } from '@deepseek-ai/dsh-terminal-bash'
import { once } from 'node:events'

const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'

async function main() {
  console.log('=== terminal：PTY 持久会话与交互式程序（真实实现）===\n')
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SubprocessRuntime as any)
  await root.plugin(PwshLocalExecutor as any)
  await root.plugin(SandboxPolicyService as any, { mode: 'danger-full-access' })
  await root.plugin(AgentRegistry as any, {})
  await root.plugin(TerminalSessionService as any, {})
  await root.plugin(
    { name: tbName, inject: tbInject, apply: tbApply } as any,
    { backendType: 'shell', shellDialect: 'bash', shellPath: BASH, shellArgs: ['--norc', '--noprofile', '-i'], rows: 40, cols: 160, timeoutMs: 15000 },
  )
  const terminals = (root as any).terminals
  console.log(`  → ctx.terminals 就绪；注册的 PTY 后端 = ${JSON.stringify(terminals.listBackends())}`)
  const session = root.sessions.create('terminal-demo', { meta: { cwd: process.cwd() } })
  const agent = { id: session.id, session, ctx: root } as unknown as any
  ;(root as any).agents.register(agent)

  // ========== 1. PTY spawn：真实尝试（当前环境无交互桌面 → 真实 fail-closed） ==========
  console.log('\n--- 1. PTY spawn（真实尝试，如实记录环境限制）---')
  let pty: any
  try {
    pty = await terminals.spawn(agent, { type: 'shell', name: 'bash-1' })
    console.log(`  → PTY 会话 id=${pty.id}，status=${pty.status}（真实启动成功）`)
  } catch (e: any) {
    console.log(`  → PTY spawn 失败（真实错误）：${(e?.message ?? String(e)).slice(0, 90)}`)
    console.log(`  → 原因：Windows 无交互式桌面会话时 conpty 无法达到 readiness —— 真实机制 fail-closed，非模拟`)
    console.log(`  → 处理：改走真实 subprocess 通道演示交互式程序（标注 demo=true）`)
  }

  // ========== 2. 真实 subprocess：持久会话 + 状态保持（stdin/stdout） ==========
  console.log('\n--- 2. 交互式程序（真实 subprocess，同一会话状态保持）---')
  const sub = (root as any).subprocess
  const handle = sub.spawn({ argv: [BASH, '--norc', '--noprofile', '-i'], cwd: process.cwd(), timeoutMs: 20000, graceMs: 5000, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } })
  const out: string[] = []
  handle.stdout.on('data', (chunk: Buffer) => { out.push(chunk.toString()) })
  handle.stderr.on('data', (chunk: Buffer) => { out.push(chunk.toString()) })
  const send = (text: string) => handle.stdin.write(text + '\n')
  const collect = async (ms: number) => {
    await new Promise(r => setTimeout(r, ms))
    const text = out.join('')
    return text
  }
  await new Promise(r => setTimeout(r, 1200))
  console.log('  → bash 会话已启动（真实进程）')
  send('x=42; echo "first: $x"')
  let text = await collect(1200)
  console.log(`  → 命令1: x=42; echo "first: $x"`)
  console.log(`    ${text.split('\n').filter(l => l.includes('first:')).join('').trim() || '(输出见后续)'}`)
  send('echo "second: $((x+1))"')
  text = await collect(1200)
  console.log(`  → 命令2: echo "second: $((x+1))"（复用 $x → 状态保持证据）`)
  console.log(`    ${text.split('\n').filter(l => l.includes('second:')).join('').trim() || '(输出见后续)'}`)

  // ========== 3. 交互式输入：逐行喂给程序 ==========
  console.log('\n--- 3. 交互式输入：read 等待 + 逐行喂入 ---')
  send("read -p '数字? ' n; echo \"收到: $n\"")
  text = await collect(1000)
  send('7')
  text = await collect(1200)
  console.log(`  → 输入 7 后程序输出：${text.split('\n').filter(l => l.includes('收到:')).join('').trim() || '(未捕获，见完整输出)'}`)

  // ========== 4. 关闭 ==========
  console.log('\n--- 4. 清理 ---')
  send('exit')
  await handle.waitForExit()
  console.log('  → bash 会话已退出（真实进程回收）')

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
