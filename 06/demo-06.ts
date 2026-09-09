// demo-06.ts
import { Context } from '@deepseek-ai/cordis'

// 让 ctx.search(query) 拥有类型（search 是可调用的服务）
declare module '@deepseek-ai/cordis' {
  interface Context {
    search(query?: string): string
  }
}

// Fiber 状态数字 → 小写名称（与 FiberState 枚举顺序一致）
const STATE_NAMES = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']

function stateName(fiber: { state: number }): string {
  return STATE_NAMES[fiber.state] ?? String(fiber.state)
}

// ── 使用方 1：依赖 search ─────────────────────────────────────────────
const consumer = {
  name: 'consumer',
  inject: ['search'],
  apply(ctx: Context) {
    console.log('  consumer 启动，search =', ctx.search('deepseek'))
  },
}

// ── 使用方 2：同样依赖 search（注册在 consumer 之后）──────────────────
const downstream = {
  name: 'downstream',
  inject: ['search'],
  apply(ctx: Context) {
    console.log('  downstream 启动，search =', ctx.search('deepseek'))
  },
}

// ── 提供者工厂：每次挂载/卸载用全新实例，避免复用已 dispose 的插件 ──
function makeSearchProvider() {
  return {
    name: 'search-provider',
    apply(ctx: Context) {
      // 提供 search 能力：Gap 闭合 → 依赖方自动激活
      ctx.provide('search', () => '搜索结果')
    },
  }
}

async function main() {
  const app = new Context()

  console.log('=== 步骤1：先挂使用方（无提供者，应停在 PENDING）===')
  const fConsumer = app.plugin(consumer)
  const fDownstream = app.plugin(downstream)
  console.log('  consumer.state =', stateName(fConsumer))
  console.log('  downstream.state =', stateName(fDownstream))

  console.log('\n=== 步骤2：挂提供者（Gap 闭合，两个使用方应自动激活）===')
  const fProvider = app.plugin(makeSearchProvider())
  await fProvider
  await fConsumer.await()
  await fDownstream.await()
  console.log('  consumer.state =', stateName(fConsumer))
  console.log('  downstream.state =', stateName(fDownstream))

  console.log('\n=== 步骤3：卸载提供者（Gap 复发，使用方应回 PENDING）===')
  await fProvider.dispose()
  console.log('  consumer.state =', stateName(fConsumer))
  console.log('  downstream.state =', stateName(fDownstream))

  console.log('\n=== 步骤4：重新挂提供者（Gap 再次闭合）===')
  const fProvider2 = app.plugin(makeSearchProvider())
  await fProvider2
  await fConsumer.await()
  await fDownstream.await()
  console.log('  consumer.state =', stateName(fConsumer))
  console.log('  downstream.state =', stateName(fDownstream))
}

main()
