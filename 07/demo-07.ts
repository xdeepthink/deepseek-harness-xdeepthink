// demo-07.ts
import { Context } from '@deepseek-ai/cordis'

let liveTimers = 0
let globalHandlers: Array<() => void> = []  // 模拟框架管不到的全局副作用

// ① 正确写法：所有副作用都登记了清理
const good = {
  name: 'good',
  apply(ctx: any) {
    ctx.effect(() => {
      liveTimers++
      const t = setInterval(() => {}, 1000)
      return () => { clearInterval(t); liveTimers-- }
    })
    ctx.effect(() => {
      const handler = () => { /* 处理事件 */ }
      globalHandlers.push(handler)
      return () => {
        const idx = globalHandlers.indexOf(handler)
        if (idx >= 0) globalHandlers.splice(idx, 1)
      }
    })
  },
}

// ② 错误写法：外部副作用没有登记清理
const bad = {
  name: 'bad',
  apply(ctx: any) {
    liveTimers++
    setInterval(() => {}, 1000)      // ← 没有登记清理
    globalHandlers.push(() => { /* 处理事件 */ })  // ← 没有登记清理
  },
}

async function run(which: any, times: number) {
  liveTimers = 0
  globalHandlers = []
  const app = new Context()
  for (let i = 0; i < times; i++) {
    const f = app.plugin(which)
    await new Promise(r => setTimeout(r, 10))
    await f.dispose()                 // dispose 是异步的，等清理完成再继续
  }
  console.log(`${which.name}: 存活定时器=${liveTimers}  全局处理器=${globalHandlers.length} 个`)
}

await run(good, 5)   // 期望：0 个定时器，0 个处理器
await run(bad, 5)    // 期望：5 个定时器，5 个处理器