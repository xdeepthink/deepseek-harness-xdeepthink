// demo-60.ts：整体架构终极复盘——四卷总装 + 六条可迁移原则
// 本实验把前 59 篇的真实机制“总装”成一条跨 Seam 完整链路：
//   WebRuntime(网络) → ApprovalService(授权) → Storage(持久化) → session(审计) → tools(执行)
// 全部真实：web fetch 真实请求、审批 fail-closed 真实、storage 原子落盘真实、
// session 事件审计真实、defineTool 注册真实。
// 六条可迁移原则为方法论复盘（标注）。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { Storage } from '@deepseek-ai/dsh-storage'
import { apply as applyJsonBackend, name as jsonBackendName, inject as jsonBackendInject } from '@deepseek-ai/dsh-storage-json'
import WebRuntime from '@deepseek-ai/dsh-web'
import { name as fetchName, inject as fetchInject, apply as fetchApply } from '@deepseek-ai/dsh-web-fetch-http'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'

async function main() {
  console.log('=== 整体架构终极复盘：跨 Seam 总装链路（全部真实）===\n')
  const root = new Context()

  // 四卷核心 Seam 真实装配
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(Storage)
  await root.plugin({ name: jsonBackendName, inject: jsonBackendInject, apply: applyJsonBackend }, { root: process.cwd() + '/.demo-60-final' })
  await root.plugin(WebRuntime as any, {})
  await root.plugin({ name: fetchName, inject: fetchInject, apply: fetchApply } as any, { maxResponseBytes: 5e6, maxBodyChars: 1e5, timeoutMs: 8000, maxRedirects: 5 })
  await root.plugin(ApprovalService)
  console.log('[总装] sessions=' + typeof (root as any).sessions?.create +
    ' tools=' + typeof (root as any).tools?.register +
    ' storage=' + typeof (root as any).storage?.backend?.get +
    ' web=' + typeof (root as any).web?.fetch +
    ' approval=' + typeof (root as any).approval?.request)

  const session = root.sessions.create('final-demo', { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session, ctx: root } as unknown as any

  // 审批：waterfall answerer 返回值契约（allowed-once/rejected/undefined）
  root.on('approval/request', (r: any) => (r.action === 'read' ? 'allowed-once' : 'rejected'))

  // 存储单元
  const unit = await (root as any).storage.backend.get('json')!.kv!.open({
    name: 'final',
    version: 1,
    tables: ['visits'],
    hasGlobal: true,
  })

  // 跨 Seam 工具：fetch_url（web + 审批）→ 记录访问（storage）→ 审计（session 事件）
  root.tools.register(defineTool({
    name: 'fetch_and_log',
    description: '抓取 URL（web Seam，真实请求）→ 审批（read）→ 记录访问次数（storage 落盘）。',
    parameters: { url: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'number' }, visits: { type: 'number' } } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async (args: any) => {
      const appr: any = await (root as any).approval.request({ agent, toolName: 'fetch_and_log', action: 'read', args })
      const outcome = typeof appr === 'string' ? appr : (appr?.outcome ?? appr?.status ?? 'unknown')
      if (outcome !== 'allowed-once') return { status: 0, visits: -1 }
      const res = await (root as any).web.fetch({ url: args.url })
      const snap = await unit.loadAll()
      const prev = snap.tables.visits?.['count']?.n ?? 0
      await unit.putRecord('visits', 'count', { n: prev + 1 })
      return { status: res.statusCode, visits: prev + 1 }
    },
  }))

  const execute = (name: string, arguments_: any) => (root as any).tools.execute({
    callId: `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    arguments: arguments_,
    agent,
    signal: new AbortController().signal,
  })

  console.log('\n--- 跨 Seam 链路：fetch_and_log（真实 web + 审批 + storage）---')
  const r1 = await execute('fetch_and_log', { url: 'https://example.com/' })
  console.log(`  → 第1次: ${JSON.stringify((r1 as any).value)}（web 真实请求 example.com）`)
  const r2 = await execute('fetch_and_log', { url: 'https://example.com/' })
  console.log(`  → 第2次: ${JSON.stringify((r2 as any).value)}（visits 由 storage 原子落盘）`)
  await unit.close()

  console.log('\n--- 审计：session 事件帧（真实）---')
  const evts = session.snapshotEvents()
  const types = evts.map((e: any) => e.type)
  console.log(`  → 事件 ${evts.length} 条，类型=${JSON.stringify([...new Set(types)])}`)

  console.log('\n--- 六条可迁移原则（方法论复盘，标注）---')
  console.log('  1) 内核只给机制不给业务：Seam 是接口，业务是插件')
  console.log('  2) 一切可审计：事件流 append-only，谁做了什么可回放')
  console.log('  3) 默认拒绝：审批 fail-closed、schema 编译期校验')
  console.log('  4) 配置决定能力：providers/开关不进代码（第56篇 pi-ai 实证）')
  console.log('  5) 插件边界靠 inject：依赖显式，缺失即不可用（第55篇实证）')
  console.log('  6) 可观测三件套：事件流→telemetry→日志，顺序排障')

  console.log('\n=== 实验完成（四卷 60 篇收官）===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
