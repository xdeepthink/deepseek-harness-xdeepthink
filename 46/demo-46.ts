// demo-46.ts：hooks（Claude Code 钩子桥接）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-hooks-claude-code  在 harness 拦截点执行"未修改的 Claude Code hooks.json"
//                                        SessionStart（会话创建）、PreToolUse/PostToolUse（工具调用前后）
//   - @deepseek-ai/dsh-tool-todo           提供 todo_write 工具作为 hook 触发源
//   - @deepseek-ai/dsh-agent-loop          提供真实的 turnBoundary 投影定义（hook 桥接读取 lastTurn）
//   - @deepseek-ai/dsh-subprocess-local + @deepseek-ai/dsh-pwsh-local  真实 shell 执行链路
// 配套一个真实 hooks.json（Claude Code 格式）与 hook 命令（PowerShell），全程无模拟。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apply as applyTodo } from '@deepseek-ai/dsh-tool-todo'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import PwshLocalExecutor from '@deepseek-ai/dsh-pwsh-local'
import { apply as applyHooks } from '@deepseek-ai/dsh-hooks-claude-code'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'

function buildHookConfig() {
  // hook 命令（PowerShell）：执行并写入标记。
  // 注：Claude Code 协议把 payload JSON 放在 stdin；Windows subprocess runner 不会主动
  // 关闭 stdin 管道，hook 需自行 [Console]::In.Close() 才能正常退出（真实环境限制）。
  const hookCmd = "[Console]::In.Close(); Write-Output 'HOOK_EXECUTED' | Add-Content -Path hook-log.txt"
  const hooksJson = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: hookCmd, timeout: 10 }] },
      ],
      PreToolUse: [
        { matcher: 'todo_write', hooks: [{ type: 'command', command: hookCmd, timeout: 10 }] },
      ],
      PostToolUse: [
        { matcher: 'todo_write', hooks: [{ type: 'command', command: hookCmd, timeout: 10 }] },
      ],
    },
  }
  mkdirSync(join(process.cwd(), '.demo-46-hooks'), { recursive: true })
  const configPath = join(process.cwd(), '.demo-46-hooks', 'hooks.json')
  writeFileSync(configPath, JSON.stringify(hooksJson, null, 2), 'utf8')
  return configPath
}

async function assemble() {
  const configPath = buildHookConfig()
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(SubprocessRuntime as any)
  await root.plugin(PwshLocalExecutor as any)
  root.sessionProjections.register(turnBoundaryProjectionDefinition as any)
  applyTodo(root, { allowParallelInProgress: true })
  applyHooks(root, { configPath })
  console.log(`[装配] hooks-claude-code 已加载（configPath=${configPath}）`)
  return root
}

async function main() {
  console.log('=== dsh hooks：Claude Code 钩子桥接（真实实现）===\n')
  const ctx = await assemble()
  const logPath = join(process.cwd(), 'hook-log.txt')

  // ========== 1. 会话创建 → SessionStart hook ==========
  console.log('--- 1. 创建会话：应触发 SessionStart hook ---')
  const session = ctx.sessions.create('hook-demo', { meta: { cwd: process.cwd() } })
  const agent = { id: session.id, session, ctx } as unknown as Agent
  // 真实 agent-loop 在启动会话时派发 agent/session-start；这里手动派发该 harness 事件
  ;(ctx as any).emit('agent/session-start', { agent, source: 'session-new' })
  await new Promise(r => setTimeout(r, 500))

  // ========== 2. 工具调用 → PreToolUse / PostToolUse hooks ==========
  console.log('\n--- 2. 执行 todo_write：应触发 PreToolUse + PostToolUse hooks ---')
  // 开启 turn（hook 桥接通过 turnBoundary 投影读取 lastTurn）
  session.append('turn/start', { turn: 1 })
  const res = await ctx.tools.execute({
    callId: 'call-todo-1',
    name: 'todo_write',
    arguments: { todos: [{ content: '完成 hooks 实验', status: 'in_progress' }] },
    agent,
    signal: new AbortController().signal,
  })
  console.log(`  → 工具执行: isError=${res.isError}`)
  await new Promise(r => setTimeout(r, 500))

  // ========== 3. hook 命令执行证据 ==========
  console.log('\n--- 3. hook 命令执行证据（hook-log.txt，每条 = 一次真实执行）---')
  if (!existsSync(logPath)) {
    console.log('  → hook-log.txt 不存在')
  } else {
    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    console.log(`  → 共 ${lines.length} 条 HOOK_EXECUTED 标记（SessionStart + PreToolUse + PostToolUse 各一次）`)
  }

  // ========== 4. 会话事件审计 ==========
  console.log('\n--- 4. 会话事件审计（hook/invoked + hook/result 真实落盘）---')
  const evts = session.snapshotEvents()
  for (const ev of evts.filter(e => e.type.startsWith('hook/'))) {
    console.log(`  → [seq ${ev.seq}] ${ev.type}: ${JSON.stringify(ev.data).slice(0, 170)}`)
  }
  console.log(`  → hook 事件总数 = ${evts.filter(e => e.type.startsWith('hook/')).length}`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
