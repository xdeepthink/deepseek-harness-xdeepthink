// demo-12.ts
// 伪代码：简化的 dsh 风格接口
// 由于没有可用的 @deepseek-ai/dsh 运行时，这里用几十行代码自实现一个
// 极简 dsh：带「事件名 → 一串处理器」的注册表，emit 时按串行中间件语义
// （处理器收到 (payload, next)，调用 next() 表示放行）执行；runUserTurn
// 内部按真实 agent 轮次的顺序触发各级事件，用 setTimeout 模拟 LLM/工具时延。

const stamp = () => new Date().toISOString().slice(11, 23)
const log: string[] = []
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ── 迷你 dsh 引擎 ──────────────────────────────────────────────
interface ToolCall { name: string; args: Record<string, string> }

const dsh = (() => {
  const handlers = new Map<string, Array<(payload: any, next: any) => any>>()

  function on(event: string, fn: (payload?: any, next?: any) => any) {
    const list = handlers.get(event)
    if (list) list.push(fn)
    else handlers.set(event, [fn])
  }

  /** 串行广播：逐个调用处理器，next() 指向下一个处理器（或链尾） */
  async function emit(event: string, payload?: any) {
    const list = handlers.get(event) ?? []
    let i = 0
    const next = async (): Promise<any> =>
      i < list.length ? list[i++](payload, next) : undefined
    const result = await next()
    await sleep(1) // 事件间留 1ms 空隙，让日志时间戳逐行递增，贴近真实框架的调度开销
    return result
  }

  // 模拟一次 LLM 调用：输入用户消息 → 决定调用 read_file 读 README
  async function fakeLLM(input: string): Promise<ToolCall[]> {
    await sleep(750) // 模拟 LLM 网络时延
    return [{ name: 'read_file', args: { path: input.includes('README') ? 'README' : 'README' } }]
  }

  // 模拟执行工具 read_file
  async function fakeToolRun(tool: ToolCall) {
    await sleep(120) // 模拟工具 IO 时延
    return `# demo-12（${tool.name} 读取到的模拟内容）`
  }

  async function runUserTurn(input: string) {
    await emit('session-start')          // 会话级：开始
    await emit('turn-start')             // 轮次级：开始

    // step 1：让 LLM 看一遍上下文，它决定要读 README（返回工具调用）
    await emit('pre-step')
    await emit('step-start')
    await emit('llm/request', { messages: [{ role: 'user', content: input }] })
    const toolCalls = await fakeLLM(input)
    await emit('llm/response', { toolCalls })
    await emit('step-end')

    // step 2：执行上一步 LLM 要求调用的工具
    for (const tool of toolCalls) {
      await emit('pre-step')
      await emit('step-start')
      await emit('tools/pre-execute', tool)
      await emit('tools/execute', tool)
      const result = await fakeToolRun(tool)
      await emit('tools/post-execute', { tool, result })
      await emit('step-end')
    }

    // 轮次级：询问是否继续（本 demo 单轮，直接收尾）
    await emit('turn-stopping', { reason: 'continue' })
    await emit('turn-end')
    await emit('session-end')            // 会话级：结束
  }

  return { on, emit, runUserTurn }
})()

// 会话级
dsh.on('session-start', () => log.push(`${stamp()} session-start`))
dsh.on('session-end',   () => log.push(`${stamp()} session-end`))

// 轮次级
dsh.on('turn-start',    () => log.push(`${stamp()} turn-start`))
dsh.on('turn-stopping', () => { log.push(`${stamp()} turn-stopping (continue)`); return null })
dsh.on('turn-end',      () => log.push(`${stamp()} turn-end`))

// 步骤级
dsh.on('pre-step',      (_: any, next: any) => { log.push(`${stamp()} pre-step`); return next() })
dsh.on('step-start',    () => log.push(`${stamp()} step-start`))
dsh.on('step-end',      () => log.push(`${stamp()} step-end`))

// 模型请求级
dsh.on('llm/request',   (payload: any, next: any) => { log.push(`${stamp()} llm/request`); return next() })
dsh.on('llm/response',  (response: any, next: any) => { log.push(`${stamp()} llm/response`); return next() })

// 工具调用级
dsh.on('tools/pre-execute',  (tool: any, next: any) => { log.push(`${stamp()} tools/pre-execute: ${tool.name}`); return next() })
dsh.on('tools/execute',       () => log.push(`${stamp()} tools/execute`))
dsh.on('tools/post-execute',  (result: any, next: any) => { log.push(`${stamp()} tools/post-execute`); return next() })

// 跑一轮用户输入
await dsh.runUserTurn('你好，帮我读一下 README')
console.log(log.join('\n'))

export {} // 让本文件成为 ESM 模块，以支持顶层 await
