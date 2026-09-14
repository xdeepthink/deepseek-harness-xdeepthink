// demo-58.ts：企业业务系统集成方案——真实工具 + 真实审批 + 能力图
// 本实验使用 dsh 真实包：
//   - @deepseek-ai/dsh-session / dsh-tools / dsh-user-approval：真实底座
// 企业集成要点（按目录）：
//   ① 数据接入：企业系统 API 以 defineTool 接入（真实机制；接口数据为演示返回，标注 demo）
//   ② 登录/权限：写入类操作走 ApprovalService（真实 fail-closed）
//   ③ 能力图：tools 注册表 = 发布层能力清单（真实枚举）
//   ④ UI 集成三种方式：iframe / 嵌入 / API——演示说明
//   ⑤ 灰度回滚：能力分级 + 事件——演示说明
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'

async function main() {
  console.log('=== 企业业务系统集成方案（真实工具 + 审批 + 能力图）===\n')
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(ApprovalService)
  console.log(`[装配] sessions=${typeof (root as any).sessions?.create} tools=${typeof (root as any).tools?.register} approval=${typeof (root as any).approval?.request}`)

  const session = root.sessions.create('enterprise-demo', { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session, ctx: root } as unknown as any

  // 审批 answerer：读取类直接放行，写入类需人工
  root.on('approval/request', (r: any) => {
    r.answer(r.action === 'read' ? 'allowed-once' : 'rejected')
  })

  // ========== ① 数据接入（真实 defineTool；ERP 数据为演示） ==========
  console.log('\n--- ① 数据接入：ERP 工具（defineTool 真实；数据 demo）---')
  root.tools.register(defineTool({
    name: 'erp_query_order',
    description: '查询 ERP 订单（只读，走 read 审批）。数据为演示返回。',
    parameters: { orderId: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { orderId: { type: 'string' }, amount: { type: 'number' }, status: { type: 'string' }, demo: { type: 'boolean' } } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async (args: any) => ({ orderId: args.orderId, amount: 1299, status: 'paid', demo: true }),
  }))
  root.tools.register(defineTool({
    name: 'erp_update_order',
    description: '更新 ERP 订单状态（写入，走写审批，策略拒绝 → 演示未执行）。',
    parameters: { orderId: { type: 'string', required: true }, status: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { updated: { type: 'boolean' }, reason: { type: 'string' } } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async (args: any) => {
      // 真实审批：action=write，answerer 返回 rejected → 不执行
      const appr: any = await (root as any).approval.request({ agent, toolName: 'erp_update_order', action: 'write', args })
      const outcome = typeof appr === 'string' ? appr : (appr?.outcome ?? appr?.status ?? 'unknown')
      return outcome === 'allowed-once' ? { updated: true } : { updated: false, reason: `approval ${outcome}` }
    },
  }))
  console.log('  → erp_query_order / erp_update_order 已注册')

  const execute = (name: string, arguments_: any) => (root as any).tools.execute({
    callId: `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    arguments: arguments_,
    agent,
    signal: new AbortController().signal,
  })

  console.log('\n--- ② 登录/权限：读放行、写拒绝（真实审批）---')
  const q = await execute('erp_query_order', { orderId: 'SO-20260912-001' })
  console.log(`  → 读（allowed-once）: ${JSON.stringify((q as any).value)}`)
  const w = await execute('erp_update_order', { orderId: 'SO-20260912-001', status: 'shipped' })
  console.log(`  → 写（rejected）: ${JSON.stringify((w as any).value)}`)

  console.log('\n--- ③ 能力图：tools 注册表 = 发布层能力（真实枚举）---')
  const schemas = (root as any).tools.schemas()
  const names = schemas.map((s: any) => s.name).filter((n: string) => !n.includes('run_code'))
  console.log(`  → 已注册能力: ${JSON.stringify(names)}（schemas() 全局视图 = 发布层能力图）`)

  console.log('\n--- ④ UI 集成三种方式（演示说明）---')
  console.log('  1) iframe 嵌入：宿主页 iframe 加载 dsh-desktop 前端（第55篇 frontend-static）')
  console.log('  2) 组件嵌入：把 dsh-client-ui-* 按需打进企业前端（41 个插件组合）')
  console.log('  3) API 集成：企业后端直连 SDK（第50/51篇 JSON-RPC / ACP），不经 UI')

  console.log('\n--- ⑤ 灰度回滚（演示说明）---')
  console.log('  能力分级发布：新工具先 demo 标签 → 内测（读权限）→ 全员（写权限）')
  console.log('  回滚：tools 注册表快照可还原（发布层版本化）；审批策略即熔断开关')

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
