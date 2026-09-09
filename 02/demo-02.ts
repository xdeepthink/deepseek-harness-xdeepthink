// demo-02.ts
import { Context } from '@deepseek-ai/cordis'

// 两个模型适配器提供方
const cloudLLM = {
  name: 'cloud-llm',
  apply: (ctx: any) => ctx.provide('llm', () => 'cloud:deepseek-v4'),
}
const localLLM = {
  name: 'local-llm',
  apply: (ctx: any) => ctx.provide('llm', () => 'local:ollama-14b'),
}

// 使用方：只认 llm 这个能力名
const agent = {
  name: 'agent',
  inject: ['llm'],
  apply: (ctx: any) => {
    console.log('  agent 使用的模型 →', (ctx as any).llm())
  },
}

const app = new Context()

// 两个隔离作用域，各自挂不同的模型实现
const sessionA = app.isolate('llm')
const sessionB = app.isolate('llm')
sessionA.plugin(cloudLLM)
sessionB.plugin(localLLM)

console.log('根上下文：')
app.plugin(agent)  // 根上下文：没有 llm，停在等待态

console.log('会话 A：')
sessionA.plugin(agent)  // 会话 A：用云端

console.log('会话 B：')
sessionB.plugin(agent)  // 会话 B：用本地