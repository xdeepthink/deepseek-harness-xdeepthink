// demo-17.ts —— 自包含演示：把 my-loop 插件挂到 mini dsh 上，复现文稿 10.4 预期输出
// 运行：npx tsx demo-17.ts
// 对应文稿 10.1「写一个极简主循环挂到 dsh 上替换官方 agent-loop」：
//   my-loop.ts      —— 60 行主循环插件（第17篇 10.2）
//   cordis.patch.yml—— 启用替换配置：禁用官方 agent-loop，挂 ./my-loop（第17篇 10.3）
import myLoop from './my-loop'

// ============ mini dsh 宿主：一个能 provide 服务、on/emit 事件、挂插件的 ctx ============

function makeBus() {
  const listeners = new Map<string, Array<(...args: any[]) => any>>()
  return {
    on(type: string, cb: (...args: any[]) => any) {
      const list = listeners.get(type) ?? []
      list.push(cb)
      listeners.set(type, list)
      return () => {
        const i = list.indexOf(cb)
        if (i >= 0) list.splice(i, 1)
      }
    },
    async emit(type: string, ...args: any[]) {
      const list = listeners.get(type)
      if (!list?.length) return
      await Promise.all(list.map((cb) => cb(...args)))
    },
  }
}

function lookup(ctx: any, name: string): any {
  let cur = ctx
  while (cur) {
    if (name in cur) return cur[name]
    cur = cur.__parent
  }
  return undefined
}

function makeCtx(parent: any, bus: ReturnType<typeof makeBus>): any {
  const ctx: any = {
    __parent: parent,
    // 服务注册
    provide(name: string, value: any) {
      ctx[name] = value
    },
    // 挂载插件（函数插件直接调用；descriptor 插件走 inject + apply）
    plugin(plugin: any) {
      if (typeof plugin === 'function') {
        plugin(ctx)
        return
      }
      const child = makeCtx(ctx, bus)
      for (const name of plugin.inject ?? []) {
        child[name] = lookup(child, name)
      }
      plugin.apply?.(child)
    },
    // 事件
    on(type: string, cb: (...args: any[]) => any) {
      bus.on(type, cb)
    },
    emit(type: string, ...args: any[]) {
      return bus.emit(type, ...args)
    },
  }
  return ctx
}

// ============ mock 服务：llm / tools ============

// llm：按消息内容决定应答，模拟「普通回答」「请求工具」「工具后总结」三态
const mockLlm = async (messages: any[]) => {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const hasToolResult = messages.some((m) => m.role === 'tool')
  if (messages.length === 1 && lastUser?.content === '现在几点了') {
    // 第一轮就要求调用 get_current_time 工具
    return { content: '', toolCalls: [{ id: 'call_1', name: 'get_current_time', args: {} }] }
  }
  if (hasToolResult) {
    // 拿到工具结果后总结
    return { content: '现在是 2026 年 9 月 6 日晚上七点半。', toolCalls: [] }
  }
  return { content: '你好！有什么可以帮助你？', toolCalls: [] }
}

const mockTools = {
  get_current_time: {
    async execute() {
      return { ok: true, value: '2026-09-06 19:30' }
    },
  },
}

const app = makeCtx(null, makeBus())
app.provide('session', {})
app.provide('llm', mockLlm)
app.provide('tools', mockTools)
app.provide('event', app)

// 挂上 my-loop，替换官方 agent-loop
myLoop(app)

// ============ 模拟一次 dsh chat：建 session/turn，触发 turn-start 让 my-loop 接管 ============

async function chat(text: string) {
  const session = { id: 'session-1' }
  const turn: any = {
    status: 'idle',
    messages: [{ role: 'user', content: text }],
  }
  await app.emit('turn-start', session, turn)
}

;(async () => {
  console.log('$ dsh chat "你好"')
  await chat('你好')

  console.log('\n$ dsh chat "现在几点了"')
  await chat('现在几点了')
})()
