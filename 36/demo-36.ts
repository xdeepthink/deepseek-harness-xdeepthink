// demo-36.ts：storage（KV 存储与数据持久化）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-storage       Storage 服务（ctx.storage）+ 后端注册表 + KvUnit 契约
//   - @deepseek-ai/dsh-storage-json  JsonStorageBackend：每单元一个 JSON 文档，原子重写落盘
// 全程不手写模拟类：单元打开、版本校验、记录写入、快照读取、删除、重开恢复全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { apply as applyJsonBackend, name as jsonBackendName, inject as jsonBackendInject } from '@deepseek-ai/dsh-storage-json'

async function assemble(rootDir: string) {
  const root = new Context()
  await root.plugin(Storage) // ctx.storage
  await root.plugin({ name: jsonBackendName, inject: jsonBackendInject, apply: applyJsonBackend }, { root: rootDir })
  console.log(`[装配] ctx.storage=${typeof root.storage}, json 后端已注册=${root.storage.backend.get('json') !== undefined}`)
  return root
}

async function main() {
  console.log('=== dsh storage：KV 存储与数据持久化（真实实现）===\n')
  const rootDir = process.cwd() + '/.demo-36-storage'
  const ctx = await assemble(rootDir)

  // ========== 1. 打开一个 KV 单元 ==========
  console.log('--- 1. 打开 KV 单元（unit: "agents"，tables: agents/sessions，含全局槽）---')
  const unit = await ctx.storage.backend.get('json')!.kv!.open({
    name: 'agents',
    version: 1,
    tables: ['agents', 'sessions'],
    hasGlobal: true,
  })
  console.log(`  → 单元已打开（${rootDir}/agents.json）`)

  // ========== 2. 写入记录（putRecord，原子落盘） ==========
  console.log('\n--- 2. putRecord：写入 3 个 agent 记录 ---')
  await unit.putRecord('agents', 'agent_001', { name: '程序员助手', model: 'deepseek-chat', active: true })
  await unit.putRecord('agents', 'agent_002', { name: '文档助手', model: 'deepseek-chat', active: false })
  await unit.putRecord('agents', 'agent_003', { name: '测试助手', model: 'deepseek-reasoner', active: true })
  console.log('  → 3 条记录已写入（每次 put 都是原子重写）')

  // ========== 3. loadAll 快照 ==========
  console.log('\n--- 3. loadAll：读取完整快照 ---')
  let snap = await unit.loadAll()
  console.log(`  → agents 表: ${JSON.stringify(snap.tables.agents)}`)
  console.log(`  → sessions 表: ${JSON.stringify(snap.tables.sessions)}`)

  // ========== 4. 覆盖写（upsert 语义）与全局槽 ==========
  console.log('\n--- 4. upsert 覆盖 + 全局槽写入 ---')
  await unit.putRecord('agents', 'agent_002', { name: '文档助手 v2', model: 'deepseek-chat', active: true })
  await unit.putRecord('sessions', 'session-1', { agentId: 'agent_001', startedAt: 1000 })
  snap = await unit.loadAll()
  console.log(`  → 覆盖后 agent_002: ${JSON.stringify(snap.tables.agents['agent_002'])}`)
  console.log(`  → sessions 表: ${JSON.stringify(snap.tables.sessions)}`)

  // ========== 5. 关闭并重开（持久化验证） ==========
  console.log('\n--- 5. 关闭单元并重新打开（数据从磁盘恢复）---')
  await unit.close()
  const unit2 = await ctx.storage.backend.get('json')!.kv!.open({
    name: 'agents',
    version: 1,
    tables: ['agents', 'sessions'],
    hasGlobal: true,
  })
  const snap2 = await unit2.loadAll()
  console.log(`  → 重开后 agents 表: ${JSON.stringify(snap2.tables.agents)}`)
  console.log(`  → 重开后 sessions 表: ${JSON.stringify(snap2.tables.sessions)}`)

  // ========== 6. 删除记录 ==========
  console.log('\n--- 6. deleteRecord：删除 agent_003 ---')
  await unit2.deleteRecord('agents', 'agent_003')
  const snap3 = await unit2.loadAll()
  console.log(`  → 删除后 agents 表: ${JSON.stringify(snap3.tables.agents)}`)

  // ========== 7. 版本不匹配拒绝 ==========
  console.log('\n--- 7. 错误路径：以不同版本号重开（应拒绝 version-mismatch）---')
  await unit2.close()
  try {
    await ctx.storage.backend.get('json')!.kv!.open({
      name: 'agents',
      version: 2,
      tables: ['agents', 'sessions'],
      hasGlobal: true,
    })
    console.log('  → ?? 未拒绝（不应该）')
  } catch (e: any) {
    console.log(`  → 被拒绝: ${e?.code ?? e?.message ?? String(e)}`)
  }

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
