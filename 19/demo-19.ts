// demo-19.ts
// 双适配器 LLM 客户端：Ollama → DeepSeek → Mock，逐级降级

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LLMAdapter {
  name: string
  chat(messages: ChatMessage[]): Promise<string>
}

// ─── 适配器 1：Ollama（本地模型）───────────────────────────
class OllamaAdapter implements LLMAdapter {
  name = 'ollama'

  constructor(
    private baseUrl = 'http://localhost:11434',
    private model = 'qwen2.5-coder:32b',
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: false }),
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json()
    return data.message?.content ?? ''
  }
}

// ─── 适配器 2：DeepSeek（云端模型）──────────────────────────
class DeepSeekAdapter implements LLMAdapter {
  name = 'deepseek'

  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.deepseek.com',
    private model = 'deepseek-chat',
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.apiKey) throw new Error('DEEPSEEK_API_KEY 未设置')
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, stream: false }),
    })
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  }
}

// ─── 适配器 3：Mock（兜底，确保 demo 一定能跑通）────────────
class MockAdapter implements LLMAdapter {
  name = 'mock'

  async chat(messages: ChatMessage[]): Promise<string> {
    const lastMsg = messages[messages.length - 1]?.content ?? ''
    return `[Mock 回复] 收到你的消息："${lastMsg}"。这是兜底适配器的模拟回复。`
  }
}

// ─── 双适配器客户端：主适配器失败自动降级─────────────────────
class DualAdapterClient {
  private adapters: LLMAdapter[]
  private lastSuccessIndex = 0

  constructor(adapters: LLMAdapter[]) {
    this.adapters = adapters
  }

  async chat(messages: ChatMessage[]): Promise<{ content: string; adapter: string }> {
    // 从上次成功的适配器开始尝试，失败则逐级降级
    for (let i = 0; i < this.adapters.length; i++) {
      const idx = (this.lastSuccessIndex + i) % this.adapters.length
      const adapter = this.adapters[idx]
      try {
        console.log(`[尝试] 适配器: ${adapter.name}`)
        const content = await adapter.chat(messages)
        this.lastSuccessIndex = idx // 记住成功的适配器，后续优先用
        return { content, adapter: adapter.name }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.log(`[失败] 适配器 ${adapter.name}: ${msg}`)
        if (i < this.adapters.length - 1) {
          console.log(`[降级] 切换到下一个适配器...`)
        }
      }
    }
    throw new Error('所有适配器都失败了')
  }
}

// ─── 演示主函数──────────────────────────────────────────────
async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY || ''

  // 适配器链：Ollama（主）→ DeepSeek（备）→ Mock（兜底）
  const client = new DualAdapterClient([
    new OllamaAdapter(),
    new DeepSeekAdapter(apiKey),
    new MockAdapter(),
  ])

  const messages: ChatMessage[] = [
    { role: 'user', content: '用一句话解释什么是双适配器降级' },
  ]

  console.log('=== 第一次调用（自动选择可用适配器）===')
  const result = await client.chat(messages)
  console.log(`\n[成功] 适配器: ${result.adapter}`)
  console.log(`回复: ${result.content}`)

  // 模拟 Ollama 离线：把 Ollama 端口改错，强制降级
  console.log('\n=== 模拟 Ollama 离线（端口改为 11435）===')
  const client2 = new DualAdapterClient([
    new OllamaAdapter('http://localhost:11435'), // 故意连错端口
    new DeepSeekAdapter(apiKey),
    new MockAdapter(),
  ])
  const result2 = await client2.chat(messages)
  console.log(`\n[成功] 适配器: ${result2.adapter}`)
  console.log(`回复: ${result2.content}`)
}

main().catch(e => console.error('Fatal:', e))