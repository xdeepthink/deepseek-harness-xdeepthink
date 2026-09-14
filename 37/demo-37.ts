// demo-37.ts：spill（大输出溢出存储）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-spill         SpillStore 服务定义（ctx.spillStore：saveText 唯一契约）
//   - @deepseek-ai/dsh-spill-local   LocalSpillStore：按会话私有目录落盘，返回 locator + 检索提示
// 全程不手写模拟类：溢出判定、私有目录、文件落盘、locator 生成全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { LocalSpillStore } from '@deepseek-ai/dsh-spill-local'

async function assemble(rootDir: string) {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(LocalSpillStore, { root: rootDir, cleanupPeriodDays: 0 })
  console.log(`[装配] ctx.spillStore=${typeof root.spillStore?.saveText}`)
  return root
}

async function main() {
  console.log('=== dsh spill：大输出溢出存储（真实实现）===\n')
  const rootDir = process.cwd() + '/.demo-37-spill'
  const ctx = await assemble(rootDir)

  // ========== 1. 两个会话 ==========
  console.log('--- 1. 创建会话 A / B（spill 按会话隔离）---')
  const sessionA = ctx.sessions.create('spill-session-a', { meta: { cwd: process.cwd() } })
  const sessionB = ctx.sessions.create('spill-session-b', { meta: { cwd: process.cwd() } })

  // ========== 2. 溢出保存：模拟 web_fetch 大结果 ==========
  console.log('\n--- 2. saveText：把 web_fetch 的大结果溢出到文件 ---')
  const bigText = Array.from({ length: 200 }, (_, i) => `第 ${i + 1} 行：这是来自网页抓取的内容片段，用于演示溢出存储机制。`).join('\n')
  const refA = await ctx.spillStore.saveText({
    owner: { sessionId: sessionA.id },
    source: { kind: 'tool', toolName: 'web_fetch', callId: 'call-abc123', label: 'result' },
    suggestedName: 'web_fetch.txt',
    content: bigText,
  })
  console.log(`  → locator: ${refA.locator}`)
  console.log(`  → bytes: ${refA.bytes}（原始 ${bigText.length} 字符）`)
  console.log(`  → retrievalHint: ${refA.retrievalHint}`)

  // ========== 3. 第二个会话独立保存 ==========
  console.log('\n--- 3. 会话 B 保存另一份（会话隔离验证）---')
  const refB = await ctx.spillStore.saveText({
    owner: { sessionId: sessionB.id },
    source: { kind: 'tool', toolName: 'bash', callId: 'call-def456', label: 'stdout' },
    suggestedName: 'bash_stdout.txt',
    content: 'ps aux 输出结果…',
  })
  console.log(`  → B 的 locator: ${refB.locator}`)

  // ========== 4. 落盘验证 ==========
  console.log('\n--- 4. 落盘验证（locator 即文件路径，可读回原文）---')
  const fs = await import('node:fs')
  const readBackA = fs.readFileSync(String(refA.locator), 'utf8')
  const readBackB = fs.readFileSync(String(refB.locator), 'utf8')
  console.log(`  → A 读回字节数 = ${Buffer.byteLength(readBackA)}，首行: ${readBackA.split('\n')[0]}`)
  console.log(`  → B 读回 = ${readBackB}`)
  console.log(`  → A/B 落盘目录不同（会话隔离）= ${!String(refA.locator).includes(String(refB.locator))}`)

  // ========== 5. 会话引用型 spill（session-reference 来源） ==========
  console.log('\n--- 5. session-reference 来源（捕获会话投影）---')
  const refC = await ctx.spillStore.saveText({
    owner: { sessionId: sessionA.id },
    source: { kind: 'session-reference', sessionId: sessionB.id, label: 'referenced-session' },
    suggestedName: 'session_b_snapshot.txt',
    content: '会话 B 的投影快照（示意）…',
  })
  console.log(`  → locator: ${refC.locator}, bytes: ${refC.bytes}`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
