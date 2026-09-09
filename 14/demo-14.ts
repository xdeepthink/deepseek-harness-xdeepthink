// demo-14.ts
import { Context } from '@deepseek-ai/cordis'

// ========== Definition（契约定义，只有接口） ==========
interface GreetingService {
  hello(name: string): string
  goodbye(name: string): string
}

// ========== Provider 1：英文实现 ==========
const englishProvider = {
  name: 'greeting-english',
  apply(ctx: any) {
    const service: GreetingService = {
      hello: (name) => `Hello, ${name}!`,
      goodbye: (name) => `Goodbye, ${name}!`,
    }
    ctx.provide('greeting', service)
  },
}

// ========== Provider 2：中文实现 ==========
const chineseProvider = {
  name: 'greeting-chinese',
  apply(ctx: any) {
    const service: GreetingService = {
      hello: (name) => `你好，${name}！`,
      goodbye: (name) => `再见，${name}！`,
    }
    ctx.provide('greeting', service)
  },
}

// ========== Consumer：依赖 greeting 契约 ==========
const consumer = {
  name: 'greeting-consumer',
  inject: ['greeting'],
  apply(ctx: any) {
    const greeting = ctx.greeting as GreetingService
    console.log(`  Consumer: ${greeting.hello('World')}`)
    console.log(`  Consumer: ${greeting.goodbye('World')}`)
  },
}

const app = new Context()

console.log('=== 步骤1：挂英文 Provider + Consumer ===')
// 先挂 Consumer（greeting 缺失 → PENDING），再挂英文 Provider → 依赖满足 → Consumer 激活
const consumerFiber = app.plugin(consumer)
const englishFiber = app.plugin(englishProvider)
await consumerFiber.await()   // 等 Consumer 完成第一次激活（打印英文问候）

console.log('\n=== 步骤2：卸载英文 Provider，挂中文 Provider ===')
// 同一个 app：卸载英文 Provider → Consumer 失去依赖回退 PENDING；
// 挂上中文 Provider → 依赖再次满足 → Consumer 自动重新激活（打印中文问候）
await englishFiber.dispose()  // 等卸载与级联回退完成
app.plugin(chineseProvider)
await consumerFiber.await()   // 等 Consumer 因依赖恢复而再次激活

console.log('\n=== 验证：Consumer 代码完全一样，但输出不同 ===')
console.log('  换 Provider 不需要改 Consumer 代码——这就是 Seam 的价值')