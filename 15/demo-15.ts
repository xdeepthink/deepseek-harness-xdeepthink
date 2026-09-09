// demo-15.ts
import { Context } from '@deepseek-ai/cordis'

// 模拟 llm Provider
const llmProvider = {
  name: 'llm-cfg',
  apply: (ctx: any) => ctx.provide('llm', () => 'deepseek-v4'),
}

// 模拟 agent-loop Consumer（依赖 llm）
const agent = {
  name: 'agent',
  inject: ['llm'],
  apply: (ctx: any) => console.log('  agent 拿到了 llm：', ctx.llm?.()),
}

// 模拟 compaction Consumer（也依赖 llm）
const compaction = {
  name: 'compaction',
  inject: ['llm'],
  apply: (ctx: any) => console.log('  compaction 拿到了 llm：', ctx.llm?.()),
}

// FiberState 是 const enum，运行时会被内联成数字（0=pending, 2=active…），这里映射回名字
const STATE_NAMES = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']
const stateName = (state: number) => STATE_NAMES[state] ?? String(state)

async function main() {
  const app = new Context()

  console.log('=== 步骤1：先挂 Consumer（llm 未就绪，停在 PENDING）===')
  const agentFiber = app.plugin(agent)
  const compactionFiber = app.plugin(compaction)
  console.log('  agent.state =', stateName(agentFiber.state))
  console.log('  compaction.state =', stateName(compactionFiber.state))

  console.log('\n=== 步骤2：挂 llm Provider（Gap 闭合，两个 Consumer 自动激活）===')
  const llmFiber = app.plugin(llmProvider)
  await llmFiber.await() // 等 Provider 激活并发布 llm（此时才会通知依赖方）
  await agentFiber.await() // 等 agent 拿到 llm 并完成激活
  await compactionFiber.await() // 等 compaction 拿到 llm 并完成激活

  console.log('\n=== 步骤3：卸载 llm Provider（Gap 复发，两个 Consumer 回退）===')
  await llmFiber.dispose() // 等卸载完成，级联通知两个 Consumer
  await agentFiber.await() // 等 agent 回退到 pending
  await compactionFiber.await() // 等 compaction 回退到 pending
  console.log('  agent.state =', stateName(agentFiber.state))
  console.log('  compaction.state =', stateName(compactionFiber.state))

  console.log('\n=== 验证：极高严重度的 llm Gap 会级联影响所有依赖它的 Consumer ===')
}

main()