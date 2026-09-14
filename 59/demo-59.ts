// demo-59.ts：生产环境踩坑与性能优化——真实机制复现
// 本实验使用 dsh 真实包：
//   - @deepseek-ai/cordis                Context / Service（生命周期、事件、状态）
//   - @deepseek-ai/dsh-session / dsh-tools / dsh-llm / dsh-llm-deepseek（并发执行）
// 真实复现三个坑：
//   坑1 热插拔残留：插件 dispose 后事件监听是否残留（dispose 应解绑）
//   坑2 Fiber 死 PENDING：Service.init 抛错 → 服务停在 PENDING（不激活不报错）
//   坑3 并发调优：多个工具真实并行执行（Promise.all）与耗时对比
// 可观测三件套（session 事件 / telemetry / 日志）为演示清单（标注）。
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply as applyDeepseek, name as deepseekName, inject as deepseekInject } from '@deepseek-ai/dsh-llm-deepseek'

declare module '@deepseek-ai/cordis' {
  interface Context { brittle: BrittleService; healthy: HealthyService }
}

// 坑2 载体：init 抛错的服务
class BrittleService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'brittle')
  }
  [Service.init]() {
    throw new Error('brittle: config missing (simulated)')
  }
}
class HealthyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'healthy')
  }
  [Service.init]() {
    console.log('  [HealthyService] init ok')
  }
}

async function main() {
  console.log('=== 生产环境踩坑与性能优化（真实机制复现）===\n')

  // ========== 坑1：热插拔残留（真实） ==========
  console.log('--- 坑1 热插拔残留：dispose 后事件是否还触发 ---')
  const root1 = new Context()
  let fired = 0
  root1.on('demo/tick', () => { fired++ })
  const plugin = {
    name: 'ticker',
    inject: [] as string[],
    apply: (ctx: any) => {
      ctx.on('demo/tick', () => { fired++ })
    },
  }
  await root1.plugin(plugin)
  root1.emit('demo/tick')
  console.log(`  → 装载后 emit：fired=${fired}（root 监听 + 插件监听）`)
  await root1.plugin(plugin) // 重复装载同一插件 = 热插拔
  root1.emit('demo/tick')
  console.log(`  → 二次装载后 emit：fired=${fired}（若插件未正确 dispose，监听叠加）`)
  await (root1 as any).fiber.dispose()

  // ========== 坑2：Fiber 死 PENDING（真实） ==========
  console.log('\n--- 坑2 Fiber 死 PENDING：Service.init 抛错 ---')
  const root2 = new Context()
  try {
    await root2.plugin(BrittleService)
    console.log('  → ?? 未抛错（不应该）')
  } catch (e: any) {
    console.log(`  → plugin(BrittleService) 抛错: ${(e?.message ?? String(e)).slice(0, 60)}`)
  }
  // 单独观察状态：在未 await 的 scope 里注册后再查询
  const root3 = new Context()
  const p = root3.plugin(BrittleService)
  console.log('  → plugin() 未 await 时的状态（fiber 生命周期）：' + JSON.stringify((root3 as any).fiber?.state ?? 'n/a'))
  try { await p } catch { /* 已处理 */ }
  await root3.plugin(HealthyService)
  console.log('  → HealthyService 独立注册正常（互不影响）')
  await (root3 as any).fiber.dispose()

  // ========== 坑3：并发调优（真实） ==========
  console.log('\n--- 坑3 并发执行：工具真实并行 ---')
  const root4 = new Context()
  await root4.plugin(SessionStore)
  await root4.plugin(SessionProjectionRegistry)
  await root4.plugin(SystemPrompt)
  await root4.plugin(ToolRuntime)
  const session = root4.sessions.create('perf-demo', { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session, ctx: root4 } as unknown as any

  const mkTool = (name: string, delayMs: number) => {
    root4.tools.register(defineTool({
      name,
      description: name,
      parameters: { x: { type: 'number', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { x: { type: 'number' } } }, render: (_a: any, v: any) => JSON.stringify(v) },
      execute: async (args: any) => { await new Promise((r) => setTimeout(r, delayMs)); return { x: args.x } },
    }))
  }
  mkTool('slow_1', 300)
  mkTool('slow_2', 300)
  mkTool('slow_3', 300)
  mkTool('fast_1', 30)

  const call = (name: string, x: number) => (root4 as any).tools.execute({
    callId: `call-${name}`,
    name,
    arguments: { x },
    agent,
    signal: new AbortController().signal,
  })

  const t0 = Date.now()
  await call('slow_1', 1); await call('slow_2', 2); await call('slow_3', 3)
  const serial = Date.now() - t0
  const t1 = Date.now()
  await Promise.all([call('slow_1', 1), call('slow_2', 2), call('slow_3', 3)])
  const parallel = Date.now() - t1
  const t2 = Date.now()
  await Promise.all([call('fast_1', 1), call('fast_1', 2), call('fast_1', 3)])
  const parallelFast = Date.now() - t2
  console.log(`  → 串行 3×300ms ≈ ${serial}ms；并行 3×300ms ≈ ${parallel}ms；并行 3×30ms ≈ ${parallelFast}ms`)
  console.log('  → 结论：工具间无依赖即可并行（ToolRuntime 支持并发 execute）；串行等待是常见浪费')
  await (root4 as any).fiber.dispose()

  // ========== 可观测三件套（演示清单） ==========
  console.log('\n--- 可观测三件套（演示清单，标注 demo）---')
  console.log('  1) session 事件流：append-only 全量留痕（第46篇，真实机制）')
  console.log('  2) telemetry：dsh-session-telemetry-otel 对接 OpenTelemetry（真实包）')
  console.log('  3) 日志/诊断：spill + 错误码（HarnessError code 链）')
  console.log('  排查顺序：先看事件流有无审批/工具帧 → 再查 telemetry 指标 → 最后定位日志')

  console.log('\n=== 实验完成 ===')
}

main().catch((err) => { console.error(err); process.exit(1) })
