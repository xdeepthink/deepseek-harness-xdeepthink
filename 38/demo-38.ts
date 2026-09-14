// demo-38.ts：session-query（会话全文检索）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-session                  会话事件源
//   - @deepseek-ai/dsh-session-persistence-jsonl 持久化后端（供引擎建索引）
//   - @deepseek-ai/dsh-session-query             SessionQueryEngine：searchSessions / searchEvents
//   - @deepseek-ai/dsh-session-query-sqlite      SqliteSessionQueryEngine：SQLite FTS5 真实全文索引
// 全程不手写模拟类：索引构建、全文检索、命中排序、片段生成全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SqliteSessionQueryEngine } from '@deepseek-ai/dsh-session-query-sqlite'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'

async function assemble(rootDir: string) {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(JsonlSessionPersistence, { root: rootDir })
  await root.plugin(SqliteSessionQueryEngine, { path: ':memory:' })
  console.log(`[装配] ctx.sessionQuery=${typeof root.sessionQuery?.searchSessions}`)
  return root
}

async function main() {
  console.log('=== dsh session-query：会话全文检索（真实实现，SQLite FTS5）===\n')
  const rootDir = process.cwd() + '/.demo-38-sessions'
  const ctx = await assemble(rootDir)

  // ========== 1. 创建两个会话并写入可检索内容 ==========
  console.log('--- 1. 创建会话 A / B 并写入事件（含关键词内容）---')
  const sessionA = ctx.sessions.create('query-session-a', { meta: { cwd: process.cwd() } })
  sessionA.append('turn/start', { turn: 1 })
  sessionA.append('user/message', createUserMessage({ role: 'user', content: [{ type: 'text', text: '帮我设计 users table，用 PostgreSQL 存储用户资料' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const msgA = createAssistantMessage({ role: 'assistant', content: [{ type: 'text', text: '好的，我建议给 users table 加数据库索引，覆盖 email 查询场景' }], source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } })
  sessionA.append('assistant/message', { message: msgA, turn: 0, step: 0, stream: [] }, { surfaceOp: 'append' })
  sessionA.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const sessionB = ctx.sessions.create('query-session-b', { meta: { cwd: process.cwd() } })
  sessionB.append('turn/start', { turn: 1 })
  sessionB.append('user/message', createUserMessage({ role: 'user', content: [{ type: 'text', text: '帮我把公众号文章改写为 xiaohongshu 风格' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  sessionB.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  // 等索引异步落地
  await new Promise(r => setTimeout(r, 500))

  // ========== 2. 按会话搜索 ==========
  console.log('\n--- 2. searchSessions：搜索 "users"（精确 token，命中会话 A）---')
  const sessionHits = await ctx.sessionQuery.searchSessions({ query: 'users', limit: 10 })
  console.log(`  → 命中 ${sessionHits.items.length} 个会话`)
  for (const hit of sessionHits.items) {
    console.log(`    ${hit.header.id}: bestMatch=seq ${hit.bestMatch.seq} [${hit.bestMatch.type}] snippet="${hit.bestMatch.snippet ?? ''}"`)
  }

  // ========== 3. 在会话 A 内按事件搜索 ==========
  console.log('\n--- 3. searchEvents：在会话 A 内搜索 "users" ---')
  const eventHits = await ctx.sessionQuery.searchEvents({ sessionId: sessionA.id, query: 'users', limit: 10 })
  console.log(`  → 命中 ${eventHits.items.length} 条事件`)
  for (const hit of eventHits.items) {
    console.log(`    ${hit.sessionId} seq=${hit.seq} [${hit.type}] snippet="${hit.snippet ?? ''}"`)
  }

  // ========== 4. 无结果搜索 ==========
  console.log('\n--- 4. 搜索不存在的关键词（"quantum"）---')
  const none = await ctx.sessionQuery.searchEvents({ sessionId: sessionA.id, query: 'quantum', limit: 10 })
  console.log(`  → 命中 ${none.items.length} 条（搜索功能正常返回空集）`)

  // ========== 5. 跨会话命中验证 ==========
  console.log('\n--- 5. 搜索 "xiaohongshu"（只应命中会话 B）---')
  const bHits = await ctx.sessionQuery.searchSessions({ query: 'xiaohongshu', limit: 10 })
  for (const hit of bHits.items) console.log(`    ${hit.header.id}: "${hit.bestMatch.snippet ?? ''}"`)

  // ========== 6. 中文分词限制（真实行为观察） ==========
  console.log('\n--- 6. 中文关键词 "数据库"（FTS5 unicode61 不分词 → 0 命中）---')
  const zhHits = await ctx.sessionQuery.searchSessions({ query: '数据库', limit: 10 })
  console.log(`  → 命中 ${zhHits.items.length} 个会话（tokenizer=unicode61 按空白/ASCII 分词，中文整句为单个 token）`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
