// demo-43.ts：extensions（Agent 运行时自我修改）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-tool-cordis  把 Cordis 运行时以工具暴露给 Agent：
//                                   cordis_define（定义不可变 Package）→ cordis_run（激活）
//                                   → cordis_stop（停止）→ cordis_undefine（永久移除）
// Agent 通过工具调用的方式在运行时注册/激活/停用/卸载自己的插件，全程不手写模拟类。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { DynamicCordisRunnerService } from '@deepseek-ai/dsh-cordis-host-runner'
import { apply as applyCordisTools } from '@deepseek-ai/dsh-tool-cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

async function assemble() {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  await root.plugin(DynamicCordisRunnerService, { vmTimeoutMs: 5000 }) // 提供 ctx.dynamicCordisRunner + ctx.cordisInspect
  applyCordisTools(root) // 注册 cordis_* 工具族
  console.log(`[装配] cordisInspect=${typeof root.cordisInspect?.register}, cordis 工具已注册`)
  return root
}

async function main() {
  console.log('=== dsh extensions：Agent 运行时自我修改（真实实现，cordis_* 工具族）===\n')
  const ctx = await assemble()

  // ========== 0. 初始会话（作为工具执行的 agent 上下文） ==========
  console.log('--- 0. 创建 agent 会话（工具执行者）---')
  const session = ctx.sessions.create('ext-demo', { meta: { cwd: process.cwd() } })
  const agent = { id: session.id, session, ctx } as unknown as Agent

  async function runTool(name: string, args: any) {
    const res = await ctx.tools.execute({ callId: `call-${name}-${Date.now()}`, name, arguments: args, agent, signal: new AbortController().signal })
    if (res.isError) throw new Error(`工具 ${name} 失败: ${JSON.stringify(res, (k, v) => typeof v === 'bigint' ? String(v) : v)}`)
    return res.value
  }

  // ========== 1. 工具清单：cordis_* 工具存在 ==========
  console.log('\n--- 1. 工具注册表：Agent 可用的自我修改工具 ---')
  const assembly = await ctx.systemPrompt.assemble({ scope: agent.id })
  const cordisTools = assembly.tools.filter(t => t.name.startsWith('cordis_'))
  console.log(`  → cordis 工具: [${cordisTools.map(t => t.name).join(', ')}]`)

  // ========== 2. cordis_define：运行时定义动态插件 ==========
  console.log('\n--- 2. cordis_define：定义动态插件（host 端：监听 session/created）---')
  const defineRes = await runTool('cordis_define', {
    plugin: { kind: 'new', idPrefix: 'demo' },
    name: 'session-watcher',
    purpose: '监听新会话创建并打印日志',
    code: {
      host: `return (ctx) => { ctx.on('session/created', (s) => { console.log('[dynamic-plugin] session/created: ' + s.id) }) }`,
    },
  })
  console.log(`  → pluginId=${defineRes.pluginId}, packageId=${defineRes.packageId}`)

  // ========== 3. cordis_run：激活插件 ==========
  console.log('\n--- 3. cordis_run：激活插件 ---')
  const runRes = await runTool('cordis_run', { pluginId: defineRes.pluginId, packageId: defineRes.packageId, mode: 'run' })
  console.log(`  → 激活结果: ${JSON.stringify(runRes)}`)

  // ========== 4. 效果验证：插件监听器真实生效 ==========
  console.log('\n--- 4. 效果验证：创建新会话触发插件监听器 ---')
  const watched = ctx.sessions.create('watched-session', { meta: { cwd: process.cwd() } })
  console.log(`  → 已创建 ${watched.id}（插件监听器应在上方打印 [dynamic-plugin] session/created）`)

  // ========== 5. cordis_inspect_self：读取动态插件状态 ==========
  console.log('\n--- 5. cordis_inspect_self：查询当前动态插件 ---')
  const inspectRes = await runTool('cordis_inspect_self', {})
  console.log(`  → ${JSON.stringify(inspectRes).slice(0, 200)}`)

  // ========== 6. cordis_stop：停止插件 ==========
  console.log('\n--- 6. cordis_stop：停止插件（定义与版本保留）---')
  const stopRes = await runTool('cordis_stop', { pluginId: defineRes.pluginId })
  console.log(`  → ${JSON.stringify(stopRes)}`)

  // ========== 7. cordis_undefine：永久移除 ==========
  console.log('\n--- 7. cordis_undefine：永久移除插件 ---')
  const undefRes = await runTool('cordis_undefine', { pluginId: defineRes.pluginId })
  console.log(`  → ${JSON.stringify(undefRes)}`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
