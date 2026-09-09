// demo-13.ts
import { existsSync, readFileSync, rmSync, appendFileSync } from 'node:fs'

const logPath = './demo-session.jsonl'

// 1. 模拟会话（简化的事件流）
const events = [
  { ts: 1, type: 'session-start', data: { id: 's1' } },
  { ts: 2, type: 'turn-start',   data: { input: '你好' } },
  { ts: 3, type: 'pre-step',     data: { step: 1 } },
  { ts: 4, type: 'llm/request',  data: { model: 'deepseek-chat' } },
  { ts: 5, type: 'llm/response', data: { output: '你好！有什么可以帮你的？' } },
  { ts: 6, type: 'step-end',     data: { result: 'hi', duration: 800 } },
  { ts: 7, type: 'turn-end',     data: {} },
  { ts: 8, type: 'session-end',  data: {} },
]

// 2. 落盘（追加式 JSONL）
for (const e of events) {
  appendFileSync(logPath, JSON.stringify(e) + '\n')
}

// 3. 检索：找出所有 llm 相关事件
const all = existsSync(logPath)
  ? readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse)
  : []
const llmEvents = all.filter(e => e.type.startsWith('llm/'))
console.log('LLM 事件数：', llmEvents.length)
console.log('LLM 事件：', llmEvents.map(e => e.type))

// 4. 检索：找出所有 step-end，计算总耗时
const stepEnds = all.filter(e => e.type === 'step-end')
const totalDuration = stepEnds.reduce((sum, e) => sum + (e.data.duration || 0), 0)
console.log('Step 数：', stepEnds.length, '总耗时：', totalDuration, 'ms')

// 5. 分叉：从 ts=4 开始重放
const forkPoint = 4
const forked = all.filter(e => e.ts >= forkPoint)
console.log('分叉点 ts=4，分叉后事件：', forked.map(e => e.type))

// 6. 清理
rmSync(logPath)