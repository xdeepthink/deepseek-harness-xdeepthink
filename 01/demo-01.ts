// demo-01.ts
import { Context } from '@deepseek-ai/cordis'

// 1 声明自定义事件 'ready'，让 ctx.on('ready') / app.emit('ready') 有正确类型
declare module '@deepseek-ai/cordis' {
  interface Events {
    'ready'(): void
  }
}

// 2 定义服务提供者：提供一个 greet 能力
const greeting = {
  name: 'greeting',
  apply(ctx: Context) {
    ctx.provide('greet', (name: string) => `Hello, ${name}!`)
  },
}

// 3 定义使用方：声明依赖 greet
const consumer = {
  name: 'consumer',
  inject: ['greet'],
  apply(ctx: Context) {
    ctx.on('ready', () => {
      console.log((ctx as any).greet('Cordis'))
    })
  },
}

// 4 挂载（注意：先后顺序无所谓，但挂载是异步的，需要 await 完成后再 emit）
const app = new Context()
// await app.plugin(greeting)
await app.plugin(consumer)

app.emit('ready')