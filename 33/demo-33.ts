// demo-33.ts：jobs（通用后台任务与异步执行引擎）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-session           会话事件源
//   - @deepseek-ai/dsh-session-projection 会话投影注册表
//   - @deepseek-ai/dsh-system-prompt      系统提示词注册表（tools 服务前置依赖）
//   - @deepseek-ai/dsh-tools              工具注册表与执行管道
//   - @deepseek-ai/dsh-jobs               JobRegistry 能力契约（JobStart/JobHooks/JobSnapshot）
//   - @deepseek-ai/dsh-jobs-local         LocalJobRegistry：进程内任务注册表实现（ctx.jobs）
//   - @deepseek-ai/dsh-tool-jobs          job_output / job_list / job_kill 模型工具
// 全程不手写模拟类：任务注册、生命周期、输出读取、取消、完成通知全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { LocalJobRegistry } from '@deepseek-ai/dsh-jobs-local'
import { apply as applyToolJobs } from '@deepseek-ai/dsh-tool-jobs'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { JobHooks, JobOutcome, JobStart } from '@deepseek-ai/dsh-jobs'

// 声明自定义 producer kind（通过声明合并扩展 JobKindMap）
declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    demo: 'demo'
  }
}

// ---------- 装配一个最小 dsh 运行时（含 jobs 能力） ----------
async function assemble(label: string) {
  const root = new Context()
  await root.plugin(SessionStore)              // ctx.sessions
  await root.plugin(SessionProjectionRegistry) // ctx.sessionProjections
  await root.plugin(SystemPrompt)              // ctx.systemPrompt（tools 前置依赖）
  await root.plugin(ToolRuntime)               // ctx.tools
  await root.plugin(AgentRegistry)             // ctx.agents（带 owner 的 job 需要）
  await root.plugin(LocalJobRegistry, { maxConcurrentJobsPerOwner: 5 }) // ctx.jobs
  // tool-jobs 的 apply 未携带静态 inject，需以插件对象形式显式声明依赖
  await root.plugin({ name: 'tool-jobs', inject: ['tools', 'jobs', 'systemPrompt'], apply: applyToolJobs }, { completionDelivery: 'quiet' }) // job_output/job_list/job_kill
  const jobTools = ['job_list', 'job_output', 'job_kill'].map(n => root.tools.get(n) !== undefined)
  console.log(`[装配] ${label}: ctx.jobs = ${typeof (root as any).jobs.start}, 工具注册 = ${jobTools.join('/')}`)
  return root
}

// ---------- 构造最小 agent 身份（真实注册进 ctx.agents，owner 必须 live） ----------
function makeAgent(ctx: Context, session: ReturnType<SessionStore['create']>): Agent {
  const agent = { id: session.id, session, ctx } as unknown as Agent
  ;(ctx as any).agents.register(agent)
  return agent
}

// ---------- 自定义 producer：模拟慢任务（增量输出 + 可取消） ----------
// JobStart 是生产者声明：kind 前缀、label、owner（拥有会话）、run() 返回 hooks。
// 运行时（LocalJobRegistry）持有身份与生命周期状态，生产者只拥有执行资源。
function startDemoTask(ctx: Context, agent: Agent, label: string, durationMs: number, tick = 200) {
  const spec: JobStart = {
    kind: 'demo',
    label,
    owner: agent,
    outputLimitBytes: 8192,
    run() {
      let cancelled = false
      let resolveDone!: (o: JobOutcome) => void
      const done = new Promise<JobOutcome>(res => { resolveDone = res })
      let output = ''
      let ticks = 0

      const ticker = setInterval(() => {
        if (cancelled) return
        ticks++
        output += `[${label}] tick ${ticks}\n`
      }, tick)

      const finish = setTimeout(() => {
        clearInterval(ticker)
        output += `[${label}] finished after ${ticks} ticks\n`
        resolveDone({ status: 'completed', detail: `exit code: 0 (${ticks} ticks)`, output })
      }, durationMs)

      return {
        cancel(reason?: string) {
          cancelled = true
          clearInterval(ticker)
          clearTimeout(finish)
          resolveDone({ status: 'killed', detail: reason || 'killed by user' })
        },
        done,
        readOutput() {
          const chunk = output
          output = ''
          return chunk
        },
      } satisfies JobHooks
    },
  }
  return (ctx as any).jobs.start(spec)
}

// ---------- 模拟模型调用一个 job 工具 ----------
async function callJobTool(ctx: Context, agent: Agent, name: string, arguments_: Record<string, unknown>) {
  const result = await ctx.tools.execute({
    callId: 'call-' + Math.random().toString(36).slice(2, 8),
    name,
    arguments: arguments_,
    agent,
    signal: new AbortController().signal,
  })
  if (result.isError) {
    console.log(`  → 被拒绝: ${(result as any).error?.message}`)
    return null
  }
  const text = typeof result.value === 'string' ? result.value : JSON.stringify(result.value)
  console.log(`  → ${text}`)
  return result.value
}

// ---------- 演示 ----------
async function main() {
  console.log('=== dsh jobs：通用后台任务与异步执行引擎（真实实现）===\n')

  // ========== 1. 装配 ==========
  console.log('--- 1. 装配 dsh 运行时（jobs-local + tool-jobs）---')
  const ctx = await assemble('jobs 运行时')
  const session = ctx.sessions.create('session-jobs-a', { meta: { cwd: process.cwd() } })
  const agent = makeAgent(ctx, session)

  // 订阅完成通知（真实 onJobDone 监听）
  const doneNotices: string[] = []
  ;(ctx as any).jobs.onJobDone((snapshot: any, owner: Agent | undefined) => {
    doneNotices.push(`${snapshot.id} ${snapshot.status} (owner=${owner?.id ?? 'unowned'})`)
    console.log(`[完成通知] ${snapshot.id} -> ${snapshot.status}`)
  })

  // ========== 2. 初始 job_list ==========
  console.log('\n--- 2. 初始 job_list（还没有任何后台任务）---')
  await callJobTool(ctx, agent, 'job_list', {})

  // ========== 3. 提交后台任务 A ==========
  console.log('\n--- 3. 提交后台任务 A（3 秒慢任务，生产者契约 JobStart）---')
  const jobA = startDemoTask(ctx, agent, '慢任务A', 3000)
  console.log(`  → ctx.jobs.start 返回 job id: ${jobA}`)

  // ========== 4. job_list 查看（running） ==========
  console.log('\n--- 4. job_list 查看（应显示 running）---')
  await callJobTool(ctx, agent, 'job_list', {})

  // ========== 5. job_output 非阻塞读增量 ==========
  console.log('\n--- 5. job_output 非阻塞读取（增量输出）---')
  await new Promise(r => setTimeout(r, 450))
  await callJobTool(ctx, agent, 'job_output', { job_id: String(jobA), wait: false })

  // ========== 6. 提交任务 B 并立即 kill ==========
  console.log('\n--- 6. 提交后台任务 B（5 秒）并立即 job_kill ---')
  const jobB = startDemoTask(ctx, agent, '慢任务B', 5000)
  console.log(`  → ctx.jobs.start 返回 job id: ${jobB}`)
  await new Promise(r => setTimeout(r, 250))
  await callJobTool(ctx, agent, 'job_kill', { job_id: String(jobB), reason: '模型判断不需要了' })

  // ========== 7. job_output 阻塞等待任务 A 完成 ==========
  console.log('\n--- 7. job_output wait=true 等待任务 A 完成 ---')
  const v = await callJobTool(ctx, agent, 'job_output', { job_id: String(jobA), wait: true, timeout_ms: 6000 })
  console.log(`  → wait 返回后快照: ${v ? JSON.stringify(v) : 'null'}`)

  // ========== 8. 会话隔离：另一个 agent 看不到 owner 的任务 ==========
  console.log('\n--- 8. 会话隔离：新 agent 的 job_list（应看不到 agentA 的任务）---')
  const session2 = ctx.sessions.create('session-jobs-b', { meta: { cwd: process.cwd() } })
  const agent2 = makeAgent(ctx, session2)
  await callJobTool(ctx, agent2, 'job_list', {})

  // ========== 9. 最终状态统计 ==========
  console.log('\n--- 9. 最终状态（owner 视角 job_list）---')
  await callJobTool(ctx, agent, 'job_list', {})
  console.log(`\n完成通知记录: ${doneNotices.join(' | ') || '（无）'}`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
