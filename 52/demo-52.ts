// demo-52.ts：dsh-remote-server（远程 SSH 运维插件）——真实工具/审批底座 + 演示远程执行
// 本实验使用 dsh 真实包：
//   - @deepseek-ai/dsh-tools            defineTool / ToolRuntime：工具定义与执行的真实机制
//   - @deepseek-ai/dsh-user-approval    ApprovalService：ctx.approval 审批 Seam（fail-closed；
//                                       answerer 通过 approval/request waterfall 事件注册；
//                                       approval/asked + approval/decided 审计对真实落盘）
//   - @deepseek-ai/dsh-session           SessionStore：会话与审计事件
// 远程 SSH 通道与服务器信息为确定性演示（本机无真实 SSH 目标），
// 工具注册、审批决策、审计事件全部走真实机制。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'

// 模拟远程主机状态（演示用）
const remote = {
  host: 'prod-01.internal',
  os: 'ubuntu-22.04',
  kernel: '5.15.0',
  uptimeSec: 86400 * 32,
  services: { nginx: 'running', postgres: 'running' },
}

async function assemble() {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(ApprovalService as any, {})
  console.log(`[装配] sessions=${typeof (root as any).sessions?.create} tools=${typeof (root as any).tools?.register} approval=${typeof (root as any).approval?.request}`)
  return root
}

async function main() {
  console.log('=== dsh-remote-server：远程 SSH 运维（真实审批底座 + 演示远程）===\n')
  const ctx = await assemble()

  // 会话 + open turn（approval 审计对要求 turn 包裹）
  const session = ctx.sessions.create('remote-ops', { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session, ctx } as unknown as any

  // ========== 1. 真实工具定义（defineTool） ==========
  console.log('--- 1. 真实工具定义（defineTool + ToolRuntime 注册）---')
  ctx.tools.register(defineTool({
    name: 'remote_server_info',
    description: '查询远程服务器的连接信息与运行状态（需通过连接审批）。',
    parameters: {
      host: { type: 'string', required: true, description: '目标主机名' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { approved: { type: 'boolean' }, error: { type: 'string' }, host: { type: 'string' }, os: { type: 'string' }, kernel: { type: 'string' }, uptimeSec: { type: 'number' }, services: { type: 'object', additionalProperties: true } } },
      render: (_args: any, value: any) => JSON.stringify(value),
    },
    execute: async (args: any) => {
      const outcome = await (ctx as any).approval.request({ agent, toolName: 'remote_server_info', action: 'connection', host: args.host })
      if (outcome !== 'allowed-once') return { error: `审批未通过: ${outcome}`, approved: false }
      return { approved: true, host: remote.host, os: remote.os, kernel: remote.kernel, uptimeSec: remote.uptimeSec, services: remote.services }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'remote_exec',
    description: '在远程主机执行命令（每类操作独立审批：command/file-read/file-write/service/credential/destructive）。',
    parameters: {
      host: { type: 'string', required: true, description: '目标主机名' },
      action: { type: 'string', required: true, description: '操作类别' },
      command: { type: 'string', required: true, description: '命令内容' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { approved: { type: 'boolean' }, stdout: { type: 'string' }, outcome: { type: 'string' } } },
      render: (_args: any, value: any) => JSON.stringify(value),
    },
    execute: async (args: any) => {
      const outcome = await (ctx as any).approval.request({ agent, toolName: 'remote_exec', action: args.action, host: args.host, command: args.command })
      if (outcome !== 'allowed-once') return { approved: false, stdout: '', outcome }
      // 演示执行：只对低危动作给出模拟输出
      const stdout = args.action === 'command'
        ? `total 12\ndrwxr-xr-x 2 root root 4096 Sep 12 10:00 /srv/app\n-rw-r--r-- 1 root root 2048 Sep 12 10:00 /srv/app/config.yaml`
        : args.action === 'file-read'
          ? `# nginx.conf\nworker_processes auto;`
          : args.action === 'file-write'
            ? `wrote 3 bytes to /tmp/dsh-demo.txt`
            : args.action === 'service'
              ? `service nginx restarted (ok)`
              : `executed`
      return { approved: true, stdout, outcome }
    },
  }))
  console.log('  → remote_server_info / remote_exec 已注册到 ctx.tools')

  // ========== 2. 审批 answerer（approval/request waterfall 事件） ==========
  console.log('\n--- 2. 审批 answerer（waterfall 事件，按 action 决策）---')
  ;(ctx as any).on('approval/request', (req: any) => {
    // 七道关卡策略：连接/命令/读文件/写文件/服务 → 允许一次；凭据/高危 → 拒绝；未知 → 不表态（fail-closed）
    const allow = ['connection', 'command', 'file-read', 'file-write', 'service']
    const deny = ['credential', 'destructive']
    if (allow.includes(req.action)) return 'allowed-once'
    if (deny.includes(req.action)) return 'rejected'
    return undefined // 不表态 → waterfall 继续 → fallback 'unavailable'
  })
  console.log('  → 策略：connection/command/file-read/file-write/service → allowed-once；credential/destructive → rejected；未知 → fail-closed')

  // ========== 3. 真实工具执行（ToolRuntime） ==========
  const execute = (name: string, arguments_: any) => (ctx as any).tools.execute({
    callId: `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    arguments: arguments_,
    agent,
    signal: new AbortController().signal,
  })

  console.log('\n--- 3. 工具执行：remote_server_info（关卡：连接）---')
  const info = await execute('remote_server_info', { host: 'prod-01' })
  console.log(`  → 完整返回: ${JSON.stringify(info).slice(0, 300)}`)

  console.log('\n--- 4. remote_exec 逐关（command / file-read / file-write / service）---')
  for (const action of ['command', 'file-read', 'file-write', 'service']) {
    const r = await execute('remote_exec', { host: 'prod-01', action, command: action === 'command' ? 'ls -la /srv/app' : action })
    const v = r.isError ? r.error : (r as any).value
    console.log(`  → ${action}: ${JSON.stringify(v).slice(0, 150)}`)
  }

  console.log('\n--- 5. 高危关卡被拒（credential / destructive）---')
  for (const action of ['credential', 'destructive']) {
    const r = await execute('remote_exec', { host: 'prod-01', action, command: action === 'destructive' ? 'rm -rf /' : 'cat ~/.ssh/id_rsa' })
    const v = r.isError ? r.error : (r as any).value
    console.log(`  → ${action}: ${JSON.stringify(v).slice(0, 150)}`)
  }

  console.log('\n--- 6. fail-closed：无 answerer 表态 → unavailable ---')
  const unknown = await execute('remote_exec', { host: 'prod-01', action: 'something-new', command: 'whoami' })
  console.log(`  → something-new: ${JSON.stringify(unknown.isError ? unknown.error : (unknown as any).value).slice(0, 150)}`)

  // ========== 7. 审计留痕（approval/asked + approval/decided 真实落盘） ==========
  console.log('\n--- 7. 审计留痕（session 事件：approval/asked + approval/decided）---')
  const evts = session.snapshotEvents().filter((e: any) => e.type.startsWith('approval/'))
  console.log(`  → approval 事件共 ${evts.length} 条（asked+decided 配对 = ${evts.length / 2} 次审批）`)
  const decided = evts.filter((e: any) => e.type === 'approval/decided')
  for (const e of decided.slice(0, 4)) {
    console.log(`  → [seq ${e.seq}] ${e.type} ${JSON.stringify(e.data).slice(0, 110)}`)
  }
  const rejectedCount = decided.filter((e: any) => e.data.outcome === 'rejected').length
  console.log(`  → 拒绝决策 ${rejectedCount} 条（credential/destructive）`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
