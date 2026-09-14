// demo-40.ts：compaction（会话历史压缩与可逆瘦身）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-compaction          CompactionEngine 服务定义 + compaction/* 会话事件契约
//   - @deepseek-ai/dsh-compaction-basic    BasicCompactionEngine：回放感知的压缩后端（token 计量 + 保留策略 + 影子替换）
//   - @deepseek-ai/dsh-token-meter         TokenMeter：回放感知 token 计量（真实估算）
// 压缩摘要 hook（summarize）是官方文档声明的唯一子类扩展点；本实验以确定性 stub 演示压缩管线，
// token 计量、保留策略、compaction/* 事件落盘与表面替换均为 dsh 真实逻辑。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/summarizer'
import type { Agent } from '@deepseek-ai/dsh-agent'

class DemoCompactionEngine extends BasicCompactionEngine {
  protected async summarize(input: SummarizationInput, _agent: Agent, _signal?: AbortSignal): Promise<SummaryResult> {
    const summary = [{ type: 'text' as const, text: '[压缩摘要] 用户确认需求清单，助手给出实现方案。' }]
    return {
      summary,
      provider: 'demo',
      model: 'demo-model',
      maxTokens: 100,
      rawOutput: summary,
    }
  }
}

async function assemble() {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(TokenMeter)
  await root.plugin(LlmRuntime)
  await root.plugin(DemoCompactionEngine, { auto: false })
  console.log(`[装配] sessions=${typeof root.sessions}, tokenMeter=${typeof root.tokenMeter}, llm=${typeof root.llm}, compaction=${typeof root.compaction}`)
  return root
}

async function main() {
  console.log('=== dsh compaction：会话历史压缩与可逆瘦身（真实实现）===\n')
  const ctx = await assemble()

  // ========== 1. 创建会话并写入多轮事件 ==========
  console.log('--- 1. 创建会话并写入 6 轮对话事件 ---')
  const session = ctx.sessions.create('compact-demo', { meta: { cwd: process.cwd() } })
  for (let t = 1; t <= 6; t++) {
    session.append('turn/start', { turn: t })
    session.append('user/message', createUserMessage({ role: 'user', content: [{ type: 'text', text: `第 ${t} 轮：请帮我确认需求清单中的功能项并给出方案` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('step/start', { turn: t, step: 0 })
    const msg = createAssistantMessage({ role: 'assistant', content: [{ type: 'text', text: `第 ${t} 轮回答：已确认功能列表，建议按优先级实现，详见方案文档。` }], source: { kind: 'model', provider: 'demo', model: 'demo-model' } })
    session.append('assistant/message', { message: msg, turn: t, step: 0, stream: [] }, { surfaceOp: 'append' })
    session.append('step/end', { turn: t, step: 0, reason: { kind: 'completed' } })
    session.append('turn/end', { turn: t, reason: { kind: 'completed' } })
  }
  console.log(`  → 事件总数 = ${session.snapshotEvents().length}`)

  // agent 对象（压缩引擎只读取 session + 路由选项）
  const agent = { id: session.id, session, ctx, options: { provider: 'demo', model: 'demo-model' } } as unknown as Agent

  // ========== 2. 压缩前测量 ==========
  console.log('\n--- 2. token 计量（压缩前）---')
  const before = await ctx.tokenMeter.measure(session)
  console.log(`  → 压缩前: requestTokens=${before.requestTokens}, surfaceTokens=${before.surfaceTokens}`)

  // ========== 3. compactRegion：压缩前五轮 ==========
  const surfaceProbe = session.snapshotEvents().filter(e => session.surface.nodes.includes(e.seq))
  console.log(`  → surface seq = [${surfaceProbe.map(e => e.seq).join(', ')}]`)
  console.log('\n--- 3. compactRegion：打开第 7 轮，把前五轮替换为一条摘要节点 ---')
  const fifthRoundEnd = surfaceProbe[9].seq // 第 5 轮 assistant 消息的 seq
  console.log(`  → 压缩区间：seq ${surfaceProbe[0].seq}..${fifthRoundEnd}（第 1-5 轮）`)
  session.append('turn/start', { turn: 7 }) // 真实 agent 在 turn 内执行压缩（compaction/start 记录 open turn）
  const result = await ctx.compaction.compactRegion(surfaceProbe[0].seq, fifthRoundEnd, agent)
  console.log(`  → compactionId = ${result.compactionId}`)
  console.log(`  → shadowedSeqs = [${result.shadowedSeqs.join(', ')}]`)
  console.log(`  → shadowedTokenCount = ${result.shadowedTokenCount}`)

  // ========== 4. 会话事件验证：compaction/* 事件落盘 + 表面替换 ==========
  console.log('\n--- 4. 会话事件日志验证（compaction/start · summary · end + 摘要 user/message）---')
  const events = session.snapshotEvents()
  for (const ev of events) {
    const brief = JSON.stringify(ev.data)?.slice(0, 80)
    console.log(`    seq=${ev.seq} ${ev.type} data=${brief}`)
  }

  // ========== 5. 表面（surface）验证：摘要替换生效、影子事件不计入 ==========
  console.log('\n--- 5. 表面投影：压缩后当前模型可见的事件 ---')
  const surface = session.snapshotEvents().filter(e => session.surface.nodes.includes(e.seq))
  for (const ev of surface) {
    console.log(`    ${ev.type} ${JSON.stringify(ev.data)?.slice(0, 100)}`)
  }

  // ========== 6. 压缩后重新计量（瘦身验证） ==========
  console.log('\n--- 6. 压缩后 token 计量（瘦身验证）---')
  const after = await ctx.tokenMeter.measure(session)
  console.log(`  → 压缩后: surfaceTokens=${after.surfaceTokens}（压缩前 ${before.surfaceTokens}）`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
