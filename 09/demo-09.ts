// demo-09.ts
import { Context } from '@deepseek-ai/cordis'

const app = new Context()

// 记录事件
const log: string[] = []
const record = (msg: string) => {
  log.push(msg)
  console.log(`  ${msg}`)
}

// ① 旧版本插件：提供 counter 服务，初始值 0
const oldPlugin = {
  name: 'counter',
  apply(ctx: any) {
    let count = 0
    record('旧版本 counter 加载')
    ctx.provide('counter', {
      inc: () => ++count,
      get: () => count,
      version: () => 'v1',
    })
    // 注册一个事件监听，验证卸载时被清理
    ctx.on('ping', () => record('旧版本 counter 收到 ping'))
  },
}

// ② 新版本插件：提供 counter 服务，初始值 100，行为不同
const newPlugin = {
  name: 'counter',
  apply(ctx: any) {
    let count = 100  // 初始值不同
    record('新版本 counter 加载')
    ctx.provide('counter', {
      inc: () => { count += 2; return count },  // 每次加 2，不是加 1
      get: () => count,
      version: () => 'v2',
    })
    ctx.on('ping', () => record('新版本 counter 收到 ping'))
  },
}

// ③ 消费方插件：依赖 counter
const consumer = {
  name: 'consumer',
  inject: ['counter'],
  apply(ctx: any) {
    record('consumer 加载')
    ctx.on('use-counter', () => {
      record(`consumer 使用 counter: inc=${ctx.counter.inc()}, get=${ctx.counter.get()}, version=${ctx.counter.version()}`)
    })
  },
}

console.log('=== 步骤1：加载旧版本 counter 和 consumer ===')
const oldFiber = app.plugin(oldPlugin)
const consumerFiber = app.plugin(consumer)
await oldFiber               // 等旧版 counter 激活
await consumerFiber.await()  // 等 consumer 因 counter 出现而激活
app.emit('use-counter')
app.emit('ping')

console.log('\n=== 步骤2：模拟 HMR——卸载旧版本，加载新版本 ===')
record('开始 HMR：卸载旧版本 counter')
await oldFiber.dispose()     // 真正等旧版卸载完成（服务与监听被清理）
record('旧版本 counter 已卸载')
const newFiber = app.plugin(newPlugin)
await newFiber               // 等新版 counter 激活
await consumerFiber.await()  // 等 consumer 因 counter 重新出现而重新激活
record('HMR 完成')

console.log('\n=== 步骤3：验证 HMR 后的行为 ===')
app.emit('use-counter')  // 应该用新版本：初始 100，每次加 2
app.emit('ping')          // 应该只有新版本收到 ping（旧版本的监听已被清理）

console.log('\n=== 完整事件日志 ===')
console.log(log.join('\n'))