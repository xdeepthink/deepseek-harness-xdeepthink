// demo-03.ts
import { Context } from '@deepseek-ai/cordis'

// 声明自定义事件 'ready'，让 ctx.on('ready') / app.emit('ready') 有正确类型
declare module '@deepseek-ai/cordis' {
  interface Events {
    'ready'(): void
  }
}

// Fiber 状态数字 → 小写名称（与 FiberState 枚举顺序一致）
const STATE_NAMES = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']

const app = new Context()

// 工具：打印 Fiber 状态
function logState(label: string, fiber: { state: number }) {
  console.log(`  [${label}] state = ${STATE_NAMES[fiber.state] ?? fiber.state}`)
}

// ① 正常插件：依赖 greet，就绪后激活
const normal = {
  name: 'normal',
  inject: ['greet'],
  apply(ctx: Context) {
    ctx.on('ready', () => console.log('  normal: ready 事件触发'))
  },
}

// ② 失败插件：apply 抛错
const failing = {
  name: 'failing',
  apply() {
    throw new Error('故意失败')
  },
}

// ③ 提供者：提供 greet 能力
const provider = {
  name: 'greet-provider',
  apply(ctx: Context) {
    ctx.provide('greet', (name: string) => `Hello, ${name}!`)
  },
}

async function main() {
  console.log('=== 步骤1：注册 normal（依赖未满足，应停在 PENDING）===')
  const f1 = app.plugin(normal)
  logState('normal', f1)

  console.log('\n=== 步骤2：注册提供者，normal 应自动激活 ===')
  await app.plugin(provider)
  await f1 // 等 normal 完成加载
  logState('normal', f1)

  console.log('\n=== 步骤3：注册 failing，应进入 FAILED ===')
  const f2 = app.plugin(failing)
  let message = ''
  try {
    await f2 // apply 抛出的错误会在 await 时被重新抛出
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  logState('failing', f2)
  console.log('  failing.error =', message)

  console.log('\n=== 步骤4：卸载 normal，应进入 DISPOSED ===')
  await f1.dispose()
  logState('normal', f1)

  console.log('\n=== 步骤5：FAILED 的 Fiber 不残留副作用 ===')
  console.log('  failing 注册的服务/事件已被回滚，应用仍正常运行')
  app.emit('ready') // normal 已卸载，不再响应；应用不会崩溃
}

main()
