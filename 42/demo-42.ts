// demo-42.ts：interaction（用户交互与审批）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-user-approval  ApprovalService（ctx.approval）：request → ApprovalOutcome；
//                                     审批策略（'ask'/'never'）与会话级 approval/policy 事件
//   - @deepseek-ai/dsh-tool-ask-user   ask_user 工具注册（消费 ctx.userQuestions 能力缝隙）
// 全程不手写模拟类：fail-closed 缺省、策略切换、审计事件（approval/asked · decided）落盘全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import ApprovalService, { ApprovalRequestId, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { apply as applyAskUser } from '@deepseek-ai/dsh-tool-ask-user'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import type { Agent } from '@deepseek-ai/dsh-agent'

async function assemble() {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(ApprovalService)
  await root.plugin(UserQuestionService)
  applyAskUser(root) // 注册 ask_user 工具
  console.log(`[装配] ctx.approval=${typeof root.approval?.request}`)
  return root
}

async function main() {
  console.log('=== dsh interaction：用户交互与审批（真实实现）===\n')
  const ctx = await assemble()

  // ========== 1. 创建会话与 agent ==========
  console.log('--- 1. 创建会话与 agent（审批请求的上下文）---')
  const session = ctx.sessions.create('interaction-demo', { meta: { cwd: process.cwd() } })
  const agent = { id: session.id, session, ctx } as unknown as Agent
  console.log(`  → session=${session.id}`)

  // ========== 2. 缺省策略（'ask'）+ 无 answerer → fail-closed ==========
  console.log('\n--- 2. 缺省策略 ask：无交互 answerer 时应 fail-closed（unavailable）---')
  session.append('turn/start', { turn: 1 }) // 真实 agent 在 turn 内请求审批
  const outcome1 = await ctx.approval.request({
    agent,
    toolName: 'bash',
    callId: ApprovalRequestId('call-bash-001'),
    reason: '执行命令 rm -rf ./dist（清理构建产物）',
  })
  console.log(`  → outcome = ${outcome1}`)

  // ========== 3. 策略切换：never（headless 严格模式） ==========
  console.log('\n--- 3. setApprovalPolicy(session, "never")：无头严格模式 ---')
  setApprovalPolicy(session, 'never')
  const outcome2 = await ctx.approval.request({
    agent,
    toolName: 'web_fetch',
    callId: ApprovalRequestId('call-fetch-001'),
    reason: '抓取外部页面',
  })
  console.log(`  → outcome = ${outcome2}（策略确定性地拒绝）`)

  // ========== 4. 审计事件：approval/asked + approval/decided 落盘 ==========
  console.log('\n--- 4. 审计事件验证（approval/asked · approval/decided · approval/policy 均写入会话日志）---')
  for (const ev of session.snapshotEvents()) {
    console.log(`    seq=${ev.seq} ${ev.type} data=${JSON.stringify(ev.data)}`)
  }

  // ========== 5. 切回 ask 策略：again fail-closed ==========
  console.log('\n--- 5. 切回 "ask" 策略（无 answerer 依然 fail-closed）---')
  setApprovalPolicy(session, 'ask')
  const outcome3 = await ctx.approval.request({ agent, toolName: 'bash', reason: '再次执行命令' })
  console.log(`  → outcome = ${outcome3}`)
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  // ========== 6. 策略事件回放（approval/policy 是最后一个生效） ==========
  console.log('\n--- 6. 策略事件回放（从日志推导当前策略：最后一条 approval/policy 生效）---')
  const policyEvents = session.snapshotEvents().filter(e => e.type === 'approval/policy')
  for (const ev of policyEvents) console.log(`    ${ev.type} policy=${(ev.data as any).policy}`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
