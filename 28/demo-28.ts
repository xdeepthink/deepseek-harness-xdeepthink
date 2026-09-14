// demo-28.ts：subagent——子代理委派与并行执行（真实实现）
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-subagent                 SubagentRuntime：ctx.subagents（子代理运行时、投影注册）
//   - @deepseek-ai/dsh-subagent-in-process-driver  startInProcessRun：进程内驱动入口（真实适配层）
//   - @deepseek-ai/dsh-agent + dsh-session      live agent 注册与会话底座
// 真实部分：SubagentRuntime 装配、subagent 投影注册、委派协议常量/深度错误类型全部走真实机制；
// 演示部分：委派决策与结果汇总（无 LLM key，不发起真实模型子轮）标注 demo=true。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SubagentRuntime, { SubagentDepthError, SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_INSTRUCTION, startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'

async function main() {
  console.log('=== subagent：子代理委派与并行执行（真实实现）===\n')
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(AgentRegistry as any, {})
  await root.plugin(SubagentRuntime as any, {})
  const session = root.sessions.create('subagent-demo', { meta: { cwd: process.cwd() } })
  const agent = { id: session.id, session, ctx: root } as unknown as any
  ;(root as any).agents.register(agent)
  console.log('  → ctx.subagents 就绪（真实 SubagentRuntime）')
  console.log(`  → SUBAGENT_DESCRIPTOR_VERSION=${SUBAGENT_DESCRIPTOR_VERSION}（委派描述符协议版本，真实常量）`)

  // ========== 1. 委派协议（真实常量与入口） ==========
  console.log('\n--- 1. 委派协议（真实 STRUCTURED_OUTPUT_INSTRUCTION / startInProcessRun）---')
  console.log(`  → 结构化输出指令前缀：${STRUCTURED_OUTPUT_INSTRUCTION.slice(0, 40)}…（真实 in-process 驱动指令）`)
  console.log(`  → startInProcessRun 类型 = ${typeof startInProcessRun}（进程内驱动入口存在）`)

  // ========== 2. 委派决策（demo=true：无 LLM key，委派轮为确定性演示） ==========
  console.log('\n--- 2. 委派决策（demo=true：子代理执行需模型驱动，本环境无 key）---')
  const tasks = [
    { id: 't1', role: 'researcher', objective: '调研 harness 事件 API' },
    { id: 't2', role: 'coder', objective: '写 demo-32 骨架' },
    { id: 't3', role: 'verifier', objective: '核验 out 输出' },
  ]
  const outcomes: Record<string, string> = { t1: 'done', t2: 'done', t3: 'pending' }
  for (const t of tasks) {
    console.log(`  → 委派 ${t.id}（${t.role}）：objective=${t.objective} → ${outcomes[t.id]}`)
  }
  console.log('  → 真实接入点：ctx.subagents.startContinuable({ provider, delegation }) 发起持久可续子代理（需模型 provider）')

  // ========== 3. 深度守卫（真实 SubagentDepthError） ==========
  console.log('\n--- 3. 深度守卫（真实 SubagentDepthError 类型）---')
  try {
    throw new SubagentDepthError('exceeded maximum subagent depth', 8, 4)
  } catch (e: any) {
    console.log(`  → 委派深度超限抛错：${e.code ?? e.name} depth=${e.depth ?? '?'} max=${e.maxDepth ?? '?'}`)
  }

  // ========== 4. 投影（真实 subagent 投影注册） ==========
  console.log('\n--- 4. subagent 投影（真实注册的 projection 定义）---')
  const proj = (root as any).sessionProjections.snapshot(session, ['subagentCatalog', 'subagentIdentity'])
  console.log(`  → snapshot(subagentCatalog, subagentIdentity) = ${JSON.stringify(proj.values).slice(0, 160)}`)
  console.log('  → 目录/身份投影已注册（真实 SubagentRuntime 装配时注入）')

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
