// demo-57.ts：Harness 二次开发标准范式（八步）——真实机制贯穿
// 本实验使用 dsh 真实包：
//   - @deepseek-ai/cordis                Context / Service：自定义 Seam 三段式（provide + 事件 + 注入方）
//   - @deepseek-ai/dsh-session           SessionStore
//   - @deepseek-ai/dsh-tools              defineTool / ToolRuntime（schema 校验 = 质量门）
// 八步范式：①识别需求 → ②选 Seam/机制 → ③定义插件骨架 → ④自定义 Seam（本实验：metric）→
// ⑤注册业务工具 → ⑥接事件 → ⑦质量门（schema 校验真实）→ ⑧执行验证。
// 其中 ①②③⑦⑧ 为真实机制；范式清单输出为演示说明。
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/cordis' {
  interface Context { metric: MetricService }
}

// ---------- ④ 自定义 Seam：MetricService（provide + 事件） ----------
class MetricService extends Service {
  private counters: Record<string, number> = {}

  constructor(ctx: Context) {
    super(ctx, 'metric')
  }

  [Service.init]() {
    console.log('  [Seam] metric 服务已就绪（自定义 Seam）')
  }

  recordMetric(name: string, delta = 1) {
    this.counters[name] = (this.counters[name] ?? 0) + delta
    this.ctx.emit('metric/recorded', { name, value: this.counters[name], delta })
  }

  snapshot() {
    return { ...this.counters }
  }
}

async function main() {
  console.log('=== Harness 二次开发标准范式（八步，真实机制）===\n')
  const root = new Context()

  // ① 装配底座（真实）：session + tools
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  console.log('[①底座] sessions=' + typeof (root as any).sessions?.create + ' tools=' + typeof (root as any).tools?.register)

  // ④ 自定义 Seam（真实）：metric 服务
  console.log('\n[④自定义 Seam] 注册 metric 服务：')
  await root.plugin(MetricService)
  const session = root.sessions.create('paradigm-demo', { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session, ctx: root } as unknown as any

  // ⑥ 事件扩展（真实）：监听 metric/recorded
  const events: any[] = []
  root.on('metric/recorded', (e: any) => events.push(e))

  // ③ 插件模板（真实）：业务插件 { name, inject, apply }，inject 依赖 metric + sessions
  console.log('\n[③插件模板] 定义并装载 business-plugin：')
  await root.plugin({
    name: 'business-plugin',
    inject: ['metric', 'sessions'],
    apply: (ctx: any) => {
      console.log('  → business-plugin 已激活（inject: metric, sessions）')
    },
  })

  // ⑤ 注册业务工具（真实 defineTool）
  console.log('\n[⑤业务工具] quality_tool（quality gate 语义）注册：')
  root.tools.register(defineTool({
    name: 'quality_tool',
    description: '业务工具示例：输入通过 schema 质量门后执行并记录 metric。',
    parameters: {
      module: { type: 'string', required: true },
      score: { type: 'number', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { passed: { type: 'boolean' }, recorded: { type: 'boolean' } } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async (args: any) => {
      (root as any).metric.recordMetric(`quality:${args.module}`, args.score >= 80 ? 1 : 0)
      return { passed: args.score >= 80, recorded: true }
    },
  }))
  console.log('  → quality_tool 已注册')

  const execute = (name: string, arguments_: any) => (root as any).tools.execute({
    callId: `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    arguments: arguments_,
    agent,
    signal: new AbortController().signal,
  })

  // ⑧ 执行验证（真实）
  console.log('\n[⑧执行验证] 两次调用（通过/不通过）：')
  const ok = await execute('quality_tool', { module: 'plugin-api', score: 95 })
  const bad = await execute('quality_tool', { module: 'plugin-api', score: 60 })
  console.log(`  → score=95: ${JSON.stringify((ok as any).value)}`)
  console.log(`  → score=60: ${JSON.stringify((bad as any).value)}`)

  // ⑦ 质量门（真实）：schema 校验拦截
  console.log('\n[⑦质量门] 错误 schema（缺 additionalProperties）被真实拦截：')
  try {
    defineTool({
      name: 'broken_tool',
      description: 'x',
      parameters: { nested: { type: 'object' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: (_a: any, v: any) => JSON.stringify(v) },
      execute: async () => ({}),
    })
    console.log('  → ?? 未拦截（不应该）')
  } catch (e: any) {
    console.log(`  → 被拦截: ${(e?.code ?? '')} ${(e?.message ?? String(e)).slice(0, 60)}`)
  }

  // ⑥ 事件回读（真实）
  console.log('\n[⑥事件] metric/recorded 事件共 ' + events.length + ' 条：')
  for (const e of events) console.log(`  → ${JSON.stringify(e)}`)
  console.log('  → metric 快照: ' + JSON.stringify((root as any).metric.snapshot()))

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
