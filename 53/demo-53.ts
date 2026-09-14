// demo-53.ts：MemOS（长期记忆）——真实存储底座 + 记忆工具语义
// 本实验使用 dsh 真实包：
//   - @deepseek-ai/dsh-storage       Storage 服务（ctx.storage）：KV 单元、原子落盘、版本校验
//   - @deepseek-ai/dsh-storage-json  JsonStorageBackend：每单元一个 JSON 文档
//   - @deepseek-ai/dsh-tools          defineTool / ToolRuntime：真实工具注册与执行
//   - @deepseek-ai/dsh-session         SessionStore：会话（工具执行上下文）
// MemOS 插件本体不在 npm 全家桶中（官方生态插件），记忆存储层用真实 storage 后端，
// 记忆工具（memo_write/read/search）用真实 defineTool 注册，语义按官方设计演示。
import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { apply as applyJsonBackend, name as jsonBackendName, inject as jsonBackendInject } from '@deepseek-ai/dsh-storage-json'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'

const NAMESPACES = ['user-preference', 'project-fact', 'long-term-goal'] as const
// storage 表名不允许连字符：官方 namespace → 下划线表名
const TABLE_OF = (ns: string) => ns.replace(/-/g, '_')
const TABLES = NAMESPACES.map(TABLE_OF)
// 敏感内容拒绝写入记忆（安全边界：密钥/凭据不进长期记忆）
const SENSITIVE = /(key|secret|password|token|credential)/i

async function assemble() {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(Storage)
  await root.plugin({ name: jsonBackendName, inject: jsonBackendInject, apply: applyJsonBackend }, { root: process.cwd() + '/.demo-53-memos' })
  console.log(`[装配] storage=${typeof (root as any).storage?.backend?.get} tools=${typeof (root as any).tools?.register}`)
  return root
}

async function main() {
  console.log('=== MemOS：长期记忆（真实 storage 底座 + 记忆工具）===\n')
  const ctx = await assemble()

  // 打开记忆单元（跨会话持久）
  const unit = await (ctx as any).storage.backend.get('json')!.kv!.open({
    name: 'memos',
    version: 1,
    tables: TABLES,
    hasGlobal: true,
  })
  console.log('  → 记忆单元 memos 已打开（JSON 落盘 .demo-53-memos/memos.json）')

  const session = ctx.sessions.create('memos-demo', { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session, ctx } as unknown as any

  // ========== 1. 真实工具定义 ==========
  console.log('\n--- 1. 记忆工具注册（defineTool）---')
  ctx.tools.register(defineTool({
    name: 'memo_write',
    description: '写入一条长期记忆（命名空间 user-preference/project-fact/long-term-goal）。敏感内容（key/secret/password/token/credential）拒绝入库。',
    parameters: {
      namespace: { type: 'string', required: true, description: '记忆命名空间' },
      key: { type: 'string', required: true, description: '记忆键' },
      content: { type: 'string', required: true, description: '记忆内容' },
      importance: { type: 'number', required: true, description: '重要性 1-5' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stored: { type: 'boolean' }, reason: { type: 'string' } } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async (args: any) => {
      if (SENSITIVE.test(args.content) || SENSITIVE.test(args.key)) {
        return { stored: false, reason: 'sensitive content rejected: credentials must use ctx.credentials, not memos' }
      }
      if (!NAMESPACES.includes(args.namespace)) return { stored: false, reason: `unknown namespace: ${args.namespace}` }
      await unit.putRecord(TABLE_OF(args.namespace), args.key, { content: args.content, importance: args.importance, ts: Date.now() })
      return { stored: true, reason: `memos/${args.namespace}/${args.key}` }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'memo_read',
    description: '读取一条长期记忆。',
    parameters: {
      namespace: { type: 'string', required: true },
      key: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, memo: { type: 'object', additionalProperties: true } } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async (args: any) => {
      const snap = await unit.loadAll()
      const row = snap.tables[TABLE_OF(args.namespace)]?.[args.key]
      return row ? { found: true, memo: row } : { found: false }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'memo_search',
    description: '按命名空间列出记忆（importance 降序），并给出计数。',
    parameters: {
      namespace: { type: 'string', required: true },
      limit: { type: 'number', description: '返回条数上限（可选）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { count: { type: 'number' }, memos: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async (args: any) => {
      const snap = await unit.loadAll()
      const rows = Object.entries(snap.tables[TABLE_OF(args.namespace)] ?? {}).map(([key, v]: any) => ({ key, ...v }))
      rows.sort((a: any, b: any) => (b.importance ?? 0) - (a.importance ?? 0))
      const limited = args.limit ? rows.slice(0, args.limit) : rows
      return { count: limited.length, memos: limited }
    },
  }))
  console.log('  → memo_write / memo_read / memo_search 已注册')

  const execute = (name: string, arguments_: any) => (ctx as any).tools.execute({
    callId: `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    arguments: arguments_,
    agent,
    signal: new AbortController().signal,
  })

  // ========== 2. 写入记忆 ==========
  console.log('\n--- 2. 写入记忆（三个命名空间）---')
  const writes = [
    ['user-preference', 'lang', '用户偏好：代码注释用中文', 3],
    ['project-fact', 'stack', '项目技术栈：Java + Python，20 年经验', 4],
    ['long-term-goal', 'ai-nutrition', '长期目标：完成 AI 营养师平台', 5],
    ['user-preference', 'style', '用户偏好：回复简洁、先结论后展开', 4],
  ] as const
  for (const [ns, key, content, importance] of writes) {
    const r = await execute('memo_write', { namespace: ns, key, content, importance })
    console.log(`  → memo_write ${ns}/${key}: ${JSON.stringify((r as any).value)}`)
  }

  // ========== 3. 敏感内容拒绝 ==========
  console.log('\n--- 3. 安全边界：敏感内容拒绝入库 ---')
  const bad = await execute('memo_write', { namespace: 'user-preference', key: 'db-password', content: 'password=hunter2', importance: 5 })
  console.log(`  → memo_write db-password: ${JSON.stringify((bad as any).value)}`)

  // ========== 4. 检索 ==========
  console.log('\n--- 4. 检索（importance 降序）---')
  const search = await execute('memo_search', { namespace: 'user-preference', limit: 10 })
  const v = (search as any).value
  console.log(`  → memo_search user-preference: count=${v.count} 顺序=${v.memos.map((m: any) => `${m.key}(imp=${m.importance})`).join(', ')}`)

  // ========== 5. 读取单条 ==========
  console.log('\n--- 5. 读取单条 ---')
  const got = await execute('memo_read', { namespace: 'long-term-goal', key: 'ai-nutrition' })
  console.log(`  → memo_read: ${JSON.stringify((got as any).value)}`)

  // ========== 6. 跨会话持久（关闭重开） ==========
  console.log('\n--- 6. 跨会话持久（关闭单元 → 重新打开 → 数据仍在）---')
  await unit.close()
  const unit2 = await (ctx as any).storage.backend.get('json')!.kv!.open({
    name: 'memos',
    version: 1,
    tables: TABLES,
    hasGlobal: true,
  })
  const snap2 = await unit2.loadAll()
  const total = NAMESPACES.reduce((n, ns) => n + Object.keys(snap2.tables[TABLE_OF(ns)] ?? {}).length, 0)
  console.log(`  → 重开后记忆总数 = ${total} 条（user-preference=${Object.keys(snap2.tables['user_preference'] ?? {}).length}）`)

  // ========== 7. 与 session 的边界 ==========
  console.log('\n--- 7. 边界：session 事件 vs MemOS ---')
  const evts = session.snapshotEvents()
  console.log(`  → 本会话事件 ${evts.length} 条（会话内，turn 包裹）；记忆 ${total} 条（跨会话，JSON 落盘）`)
  console.log('  → 边界：session 保存“发生过什么”，MemOS 保存“应该记住什么”')

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
