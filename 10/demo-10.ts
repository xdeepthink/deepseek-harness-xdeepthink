// demo-10.ts
import { Context } from '@deepseek-ai/cordis'

// 声明自定义事件 'shutdown'，让 ctx.on('shutdown') / app.emit('shutdown') 有正确类型
declare module '@deepseek-ai/cordis' {
  interface Events {
    'shutdown'(): void
  }
}

const log: string[] = []
const record = (msg: string) => {
  log.push(msg)
  console.log(`  ${msg}`)
}

const app = new Context()

// 插件1：提供 greeting 服务
const greetingPlugin = {
  name: 'greeting',
  apply(ctx: any) {
    record('greeting 插件加载')
    ctx.provide('greeting', (name: string) => `Hello, ${name}!`)
    ctx.on('shutdown', () => record('greeting 收到 shutdown'))
  },
}

// 插件2：依赖 greeting，提供 user 服务
const userPlugin = {
  name: 'user',
  inject: ['greeting'],
  apply(ctx: any) {
    record('user 插件加载')
    ctx.provide('user', {
      greet: (name: string) => ctx.greeting(name),
    })
    ctx.on('shutdown', () => record('user 收到 shutdown'))
  },
}

// 插件3：依赖 user，纯消费
const appPlugin = {
  name: 'app',
  inject: ['user'],
  apply(ctx: any) {
    record('app 插件加载')
    record(`app 调用 user.greet: ${ctx.user.greet('World')}`)
    ctx.on('shutdown', () => record('app 收到 shutdown'))
  },
}

console.log('=== 启动链路：按依赖顺序自动激活 ===')
// 注意：故意按反顺序注册，验证框架自动推导依赖顺序
const appFiber = app.plugin(appPlugin)         // 依赖 user，user 还没加载 → PENDING
const userFiber = app.plugin(userPlugin)        // 依赖 greeting，greeting 还没加载 → PENDING
const greetingFiber = app.plugin(greetingPlugin) // 无依赖 → 立即激活 → 级联触发 user、app 激活
await greetingFiber          // 等 greeting 激活
await userFiber.await()      // 等 user 因依赖满足而被激活
await appFiber.await()       // 等 app 因依赖满足而被激活

console.log('\n=== 运行链路：发事件，所有插件响应 ===')
app.emit('shutdown')

console.log('\n=== 卸载链路：卸载 greeting，级联回退 ===')
// 卸载 greeting：级联让 user、app 因失去依赖而回退到 PENDING
await greetingFiber.dispose()   // 等卸载（含级联回退）真正完成
record('greeting 插件已卸载')

console.log('\n=== 验证：greeting 卸载后，user 和 app 应回退 ===')
// 此时 user 和 app 应该回 PENDING（因为依赖的 greeting 消失了）
record(`user 服务是否还在: ${typeof (app as any).user === 'undefined' ? '不在' : '在'}`)

console.log('\n=== 完整事件日志 ===')
console.log(log.join('\n'))