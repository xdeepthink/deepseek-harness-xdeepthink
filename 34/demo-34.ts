// demo-34.ts：schedule（定时提醒与计划任务）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-session                会话事件源（schedule/change 事件落盘）
//   - @deepseek-ai/dsh-session-projection     会话投影注册表
//   - @deepseek-ai/dsh-system-prompt          系统提示词注册表
//   - @deepseek-ai/dsh-tools                  工具注册表与执行管道
//   - @deepseek-ai/dsh-agent                  AgentRegistry（agent 注册）
//   - @deepseek-ai/dsh-schedule               计划域：ScheduleRecord/ScheduleChange、折叠视图、
//                                             registerScheduleTools（schedule_create/list/delete）、
//                                             ScheduleRuntime（真实定时引擎，触发 dispatch 落盘）
// 全程不手写模拟类：提醒规则、持久化、折叠、定时触发全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { apply as applySchedule } from '@deepseek-ai/dsh-schedule'
import type { Agent } from '@deepseek-ai/dsh-agent'

// ---------- 装配最小 dsh 运行时 ----------
async function assemble(label: string, rootDir: string) {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(AgentRegistry)
  await root.plugin(JsonlSessionPersistence, { root: rootDir }) // ctx.sessionPersistence（JSONL 真实落盘）
  // schedule 的 apply 未携带静态 inject，需以插件对象形式显式声明依赖
  await root.plugin(
    { name: 'schedule', inject: ['agents', 'sessions', 'tools', 'sessionPersistence', 'sessionProjections'], apply: applySchedule },
  )
  console.log(`[装配] ${label}: sessions=${typeof root.sessions.create}, sessionPersistence=${typeof (root as any).sessionPersistence?.create}`)
  return root
}

// ---------- 构造并注册 agent（带作用域 ctx） ----------
function makeAgent(ctx: Context, session: ReturnType<SessionStore['create']>): Agent {
  const agent = { id: session.id, session, ctx } as unknown as Agent
  ;(ctx as any).agents.register(agent)
  return agent
}

// ---------- 模拟模型调用 schedule 工具 ----------
async function callScheduleTool(ctx: Context, agent: Agent, name: string, arguments_: Record<string, unknown>) {
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
  console.log(`  → ${typeof result.value === 'string' ? result.value : JSON.stringify(result.value)}`)
  return result.value
}

// ---------- 演示 ----------
async function main() {
  console.log('=== dsh schedule：定时提醒与计划任务（真实实现）===\n')

  // ========== 1. 装配 ==========
  console.log('--- 1. 装配 dsh 运行时（含 sessionPersistence JSONL 落盘）---')
  const rootDir = process.cwd() + '/.demo-34-sessions'
  const ctx = await assemble('schedule 运行时', rootDir)
  const session = ctx.sessions.create('session-sched-a', { meta: { cwd: process.cwd() } })

  // 观察会话事件流（schedule/change 是真实落盘事件）
  const events: string[] = []
  ctx.on('session/event', (_s: any, event: any) => {
    if (event.type === 'schedule/change') {
      const op = event.data?.operation ?? '?'
      const id = event.data?.schedule?.id ?? event.data?.id ?? '?'
      events.push(`seq=${event.seq} ${op}(${id})`)
      console.log(`[会话事件] seq=${event.seq} schedule/change ${op} id=${id}`)
    }
  })

  // ========== 2. 注册 agent：触发 agent/created，schedule 自动安装工具与引擎 ==========
  console.log('\n--- 2. 注册 agent（agent/created → schedule 自动安装）---')
  console.log(`  → 注册前 schedule_create = ${ctx.tools.get('schedule_create') !== undefined}`)
  const agent = makeAgent(ctx, session)
  await new Promise(r => setTimeout(r, 50)) // 等 agent/created 同步处理完成
  console.log(`  → 注册后 schedule_create = ${ctx.tools.get('schedule_create') !== undefined}`)
  console.log(`  → ScheduleRuntime 已由 schedule 插件随 agent 生命周期启动`)

  // ========== 3. 创建一个 3 秒后的一次性提醒 ==========
  console.log('\n--- 3. schedule_create：3 秒后提醒（after 规则）---')
  await callScheduleTool(ctx, agent, 'schedule_create', {
    after_seconds: 3,
    prompt: '检查需求文档是否已确认',
  })

  // ========== 4. 创建第二个提醒（5 秒后，随后删除） ==========
  console.log('\n--- 4. schedule_create：5 秒后提醒（稍后删除）---')
  const r2 = await callScheduleTool(ctx, agent, 'schedule_create', {
    after_seconds: 5,
    prompt: '整理原型图反馈',
  })

  // ========== 5. schedule_list 查看全部活动提醒 ==========
  console.log('\n--- 5. schedule_list（当前活动提醒）---')
  await callScheduleTool(ctx, agent, 'schedule_list', {})

  // ========== 6. 删除第二个提醒 ==========
  console.log('\n--- 6. schedule_delete：取消第二个提醒 ---')
  if (r2 && typeof r2 === 'object' && 'id' in (r2 as any)) {
    await callScheduleTool(ctx, agent, 'schedule_delete', { id: (r2 as any).id })
  }

  // ========== 7. 等待 3 秒提醒触发（dispatch 落盘） ==========
  console.log('\n--- 7. 等待 4 秒，让 3 秒提醒被调度引擎触发 ---')
  await new Promise(r => setTimeout(r, 4200))
  await callScheduleTool(ctx, agent, 'schedule_list', {})

  // ========== 8. 会话事件日志回放（schedule 持久化协议） ==========
  console.log('\n--- 8. 会话事件日志（schedule/change 的完整协议）---')
  for (const ev of session.snapshotEvents()) {
    if (ev.type === 'schedule/change') {
      const d = ev.data as any
      if (d.operation === 'create') console.log(`seq=${ev.seq} create ${d.schedule.kind} id=${d.schedule.id} prompt="${d.schedule.prompt}" at=${d.schedule.scheduledAt}`)
      else if (d.operation === 'delete') console.log(`seq=${ev.seq} delete id=${d.id}`)
      else console.log(`seq=${ev.seq} dispatch id=${d.id}`)
    }
  }

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
