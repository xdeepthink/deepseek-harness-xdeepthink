// my-loop.ts（60 行精简版）
import type { Context, Session, Turn } from '@deepseek-ai/cordis'

export default function myLoop(ctx: Context) {
  ctx.plugin({
    name: 'my-loop',
    inject: ['session', 'llm', 'tools', 'event'],

    async apply(ctx) {
      ctx.on('turn-start', async (session: Session, turn: Turn) => {
        turn.status = 'thinking'
        console.log('[my-loop] Turn started')

        while (!turn.finalAnswer) {
          // 1. 调 LLM
          console.log('[my-loop] Calling LLM with', turn.messages.length, 'messages')
          const llm = await ctx.llm(turn.messages)
          turn.messages.push({ role: 'assistant', content: llm.content })

          // 2. 处理工具调用
          if (llm.toolCalls?.length) {
            console.log('[my-loop] LLM requested', llm.toolCalls.length, 'tool(s)')
            for (const call of llm.toolCalls) {
              const tool = ctx.tools[call.name]
              const result = await tool.execute(call.args, session)
              console.log('[my-loop] Tool', call.name, 'returned:', result.ok ? 'ok' : 'error')
              turn.messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: result.ok ? JSON.stringify(result.value) : `ERR: ${result.error}`,
              })
            }
            turn.status = 'tool-calling'
            continue
          }

          // 3. 没有工具调用就是终态（模型给出最终应答时才汇报）
          console.log('[my-loop] LLM responded:', llm.content?.slice(0, 50))
          turn.finalAnswer = llm.content
          turn.status = 'done'
          console.log('[my-loop] No tool calls, final answer set')
        }

        turn.endedAt = Date.now()
        console.log('[my-loop] Turn ended')
      })
    },
  })
}