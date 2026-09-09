// demo-16.ts
import { Context } from '@deepseek-ai/cordis'

// 模拟一个 llm 插件
const llmProvider = {
  name: 'llm',
  apply: (c: any) => {
    console.log('[Fiber] llm 进入 ACTIVE')
    c.provide('llm', async (prompt: string) => {
      console.log('[Agent FSM] llm 处理：', prompt.slice(0, 20))
      return { ok: true, content: '响应' }
    })
  },
}

// 模拟一个故意抛错的插件
const badProvider = {
  name: 'bad',
  apply: (_c: any) => {
    throw new Error('故意失败')
  },
}

// 模拟一个需要审批的工具（卡在 awaiting-permission）
const toolWithApproval = {
  name: 'risky-tool',
  inject: ['llm'],
  apply: (ctx: any) => {
    console.log('[Fiber] risky-tool 进入 ACTIVE')
    ctx.provide('risky-tool', async () => {
      console.log('[Agent FSM] risky-tool 等待审批...')
      // 模拟审批永远不响应（实际代码里会有超时）
      await new Promise(() => {})  // 永远 pending
    })
  },
}

// 模拟一个业务会话
async function fakeSession(ctx: any, name: string, useRiskyTool = false) {
  console.log(`[Session ${name}] 启动`)
  try {
    if (useRiskyTool) {
      console.log(`[Session ${name}] 调用 risky-tool（会卡在 awaiting-permission）`)
      await ctx['risky-tool']()  // 会永远卡住
    } else {
      const result = await ctx.llm(`${name} 的请求`)
      console.log(`[Session ${name}] 完成：`, result)
    }
  } catch (e) {
    console.log(`[Session ${name}] 失败：`, (e as Error).message)
  }
}

;(async () => {
  const app = new Context()

  // 先把两个插件都激活（挂载是异步的，等它们都进入 ACTIVE 再开始场景）
  const llmFiber = app.plugin(llmProvider)
  const toolFiber = app.plugin(toolWithApproval)
  await llmFiber.await()
  await toolFiber.await()

  // 场景1：插件 ACTIVE，会话卡在 awaiting-permission
  console.log('\n=== 场景1：插件 ACTIVE，会话卡在 awaiting-permission ===')
  fakeSession(app, 'A', true)
  await new Promise(r => setTimeout(r, 100))  // 等 100ms
  console.log('[观察] 会话 A 卡住了，但 llm 和 risky-tool 的 Fiber 都是 ACTIVE')

  // 场景2：一个坏插件挂上，框架隔离
  console.log('\n=== 场景2：一个坏插件挂上，框架隔离 ===')
  const badFiber = app.plugin(badProvider)
  try {
    await badFiber.await() // 启动失败会被 Fiber 捕获，await 时抛出
  } catch (e) {
    console.log('[Fiber] bad FAILED 被隔离，其他插件无感')
  }
  // 坏插件不影响其他会话
  await fakeSession(app, 'B')

  // 场景3：会话结束，插件仍 ACTIVE（可服务下一个）
  console.log('\n=== 场景3：会话结束，插件仍 ACTIVE ===')
  console.log('[Fiber] llm 仍 ACTIVE，继续服务下一个会话')
  await fakeSession(app, 'C')
})()