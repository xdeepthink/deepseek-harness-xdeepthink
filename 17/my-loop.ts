// dsh 真实源码契约实现，全部走真实 API：
//
//   1) 注册：agents registry 暴露 ctx.agents.setFactory(factory)；
//      官方 @deepseek-ai/dsh-agent-loop 的 AgentLoop 就是构造时把自己
//      setFactory 进去（因此 patch 里必须先 disabled 它，否则
//      "an agent factory is already registered"）。
//      factory 只需实现 createAgent(ownerCtx, options)。
//
//   2) 消费：headless-runner 的流程是
//        agents.create(...)            -> 调用 factory.createAgent
//        await agent.whenIdle()
//        agent.followup(createUserMessage(...))   // 一次任务 = 一个 turn
//        await agent.whenIdle()
//        sessions.flush(agent.session)
//        summarize(agent.session.events)
//      summarize 只认三类事件：
//        turn/start         -> 开始累积
//        assistant/message  -> data.message.content 里 type==='text' 的 text join
//        turn/end           -> data.reason（kind === 'completed' 才 exit 0）
//
//   3) Session：sessions.prepare(id, {meta}) 造裸 Session；
//      sessions.enter(session) 之后 flush / events / seq 才生效；
//      session.append(type, data, {surfaceOp:'append'}) 写事件。
import type { Context } from '@deepseek-ai/cordis'

const TAG = '[my-loop-2]'

/** loader 会把默认导出当插件调用；内部再以 inject 声明式注册 */
export default function takeOverAgentLoop(root: Context) {
  root.plugin({
    name: 'my-loop-2',
    // 必须声明 inject，否则访问 ctx.agents / ctx.sessions 会报
    // 'cannot get property "agents" without inject'（Cordis 注入契约）
    inject: ['agents', 'sessions'],

    async apply(ctx: Context) {
      const agents: any = (ctx as any).agents
      const sessions: any = (ctx as any).sessions
      if (!agents?.setFactory || !sessions?.prepare) {
        console.error(`${TAG} 未找到 agents / sessions 服务：请确认官方 agent-loop 已被 disabled。`)
        return
      }

      // 抽取 message.content 里的 text block（与 headless summarize 同一取法）
      const textOf = (message: any): string =>
        (message?.content ?? [])
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => b.text)
          .join('')

      const factory = {
        /** 真实 createAgent：按 dsh-headless / agent-loop 消费面最小实现 */
        async createAgent(_ownerCtx: Context, options: any) {
          // 1) 真实 Session（含 header.cwd / events / seq）
          const session = sessions.prepare(
            options.sessionId,
            options.meta === void 0 ? {} : { meta: options.meta },
          )
          // 2) enter 进 store：flush / session/event 发布才生效；detach 用于卸下
          const detach = sessions.enter(session)
          let alive = true

          const agent: any = {
            id: session.id,
            session,
            // 自定义驱动不依赖 defaultModel / tools，setup 回调被忽略；
            // ctx.agent 自引用以兼容后续若有人读 ctx.agent。
            ctx: {},

            whenIdle: () => Promise.resolve(),

            /** headless 每调一次 followup 视为一个新 turn：同步驱动、无 LLM */
            followup(message: any) {
              const lastTurn =
                session.events
                  .filter((e: any) => e.type === 'turn/start')
                  .at(-1)?.data.turn ?? 0
              const turn = lastTurn + 1

              session.append('turn/start', { turn })
              session.append('user/message', message, { surfaceOp: 'append' })

              const asked = textOf(message)
              const reply = answer(asked)

              session.append(
                'assistant/message',
                {
                  turn,
                  step: 1,
                  message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: reply }],
                    source: { provider: 'my-loop-2', model: 'echo-v1' },
                  },
                },
                { surfaceOp: 'append' },
              )
              session.append('turn/end', { turn, reason: { kind: 'completed' } })

              console.log(`${TAG} turn#${turn} 由自定义驱动应答：${JSON.stringify(asked)}`)
            },

            cancel() {
              /* 自定义驱动无异步在途任务 */
            },
          }
          agent.ctx.agent = agent

          return {
            agent,
            dispose: async () => {
              if (!alive) return
              alive = false
              try {
                detach()
              } catch {
                /* 已卸载则忽略 */
              }
            },
          }
        },

        /** headless 一次性任务只走 create；resume 面仅占位声明 */
        resume(_ownerCtx: Context, _options: any) {
          throw new Error(`${TAG} resume 未实现（headless 演示只覆盖 create 路径）`)
        },
      }

      agents.setFactory(factory)
      console.log(`${TAG} factory 已注册 —— 官方 agent-loop 已被本工厂顶替`)
    },
  })
}

/** 自定义循环驱动：无 LLM 的规则应答，用于证明「接管生效」 */
function answer(text: string): string {
  const t = text.trim()
  if (t.toLowerCase() === 'ping') return 'pong'
  return `my-loop-2 已真实接管循环。收到：「${text}」——本回复由自定义工厂生成（未接 LLM），官方 agent-loop 处于禁用状态。`
}
