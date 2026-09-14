// demo-39.ts：context（模型请求上下文的七阶段组装流水线）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-system-prompt  SystemPrompt 注册表：section（系统提示区段）/ context（动态上下文）
//                                     / variable（变量）/ assemble（组装）→ renderPrompt / renderContextSnapshot
//   - @deepseek-ai/dsh-tools          工具注册（todo_write 等 schema 进入组装）
//   - @deepseek-ai/dsh-tool-todo      applyTodo 注册真实 todo_write 工具
// 全程不手写模拟类：区段排序、上下文快照、工具 schema 收集、变量插值全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderPrompt, renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { apply as applyTodo } from '@deepseek-ai/dsh-tool-todo'

async function assemble() {
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  applyTodo(root, { allowParallelInProgress: true }) // 注册真实 todo_write 工具（schema 进入组装）
  console.log(`[装配] ctx.systemPrompt=${typeof root.systemPrompt?.assemble}, 工具已注册`)
  return root
}

async function main() {
  console.log('=== dsh context：模型请求上下文的七阶段组装流水线（真实实现）===\n')
  const ctx = await assemble()

  // ========== 阶段 1-2：身份区段 + 任务区段（section，按 order 升序） ==========
  console.log('--- 阶段1/2：注册系统提示区段（身份 / 任务 / 规范 / 工具指引）---')
  ctx.systemPrompt.section({ name: 'harness-identity', order: -1000, text: '你是 DeepSeek Harness Agent，运行在受控沙箱环境中。' })
  ctx.systemPrompt.section({ name: 'task', order: 100, text: '你的任务：完成用户提出的需求，优先使用可用工具自主推进。' })
  ctx.systemPrompt.section({ name: 'output-rules', order: 300, text: '输出规范：结果用简体中文；涉及事实必须引用来源。' })
  ctx.systemPrompt.section({ name: 'tool-usage', order: 500, text: (a) => `当前工作目录：${a.scope === undefined ? '（全局作用域）' : String(a.scope)}；工具调用需通过 tools.execute。` })
  ctx.systemPrompt.section({ name: 'timestamp', order: 600, text: '当前时间：{{now}}（由变量提供器注入）' })
  console.log('  → 4 个区段已注册（order: -1000 / 100 / 300 / 500）')

  // ========== 阶段 3：动态上下文（context，函数式求值） ==========
  console.log('\n--- 阶段3：注册动态上下文（context 快照）---')
  ctx.systemPrompt.context({
    name: 'session-state',
    title: '会话状态',
    order: 100,
    text: () => '当前会话：context-demo-session，投影未挂载（无 todo 数据）。',
  })
  ctx.systemPrompt.context({
    name: 'environment',
    title: '环境信息',
    order: 200,
    text: () => `进程平台：${process.platform} / Node ${process.version}`,
  })
  console.log('  → 2 个动态上下文已注册（会话状态 / 环境信息）')

  // ========== 阶段 4：变量（variable，延迟插值） ==========
  console.log('\n--- 阶段4：注册变量（{{now}} / {{session_id}}）---')
  ctx.systemPrompt.variable('now', () => new Date().toISOString().slice(0, 19).replace('T', ' '))
  ctx.systemPrompt.variable('session_id', () => 'context-demo-session')
  console.log('  → 2 个变量提供器已注册')

  // ========== 阶段 5：组装（assemble：排序 + 收集工具 + 解析变量） ==========
  console.log('\n--- 阶段5：assemble() 组装（区段排序 / 工具 schema / 变量解析）---')
  const assembly = await ctx.systemPrompt.assemble()
  console.log(`  → sections 数量 = ${assembly.sections.length}（含 dsh 内置 persona 区段），顺序 = [${assembly.sections.map(s => s.name).join(', ')}]`)
  console.log(`  → contexts 数量 = ${assembly.contexts.length}，标题 = [${assembly.contexts.map(c => c.title).join(', ')}]`)
  console.log(`  → tools schema = [${assembly.tools.map(t => t.name).join(', ')}]`)
  console.log(`  → variables = ${JSON.stringify(assembly.variables)}`)

  // ========== 阶段 6：渲染（renderPrompt：拼接 + 变量插值） ==========
  console.log('\n--- 阶段6：renderPrompt() 渲染系统提示（含变量插值）---')
  const rendered = renderPrompt(assembly)
  console.log('  → 渲染结果:')
  rendered.split('\n').forEach(line => console.log(`    ${line}`))
  console.log(`  → 变量插值生效（{{now}} 已替换为 "${assembly.variables.now}"）= ${rendered.includes(assembly.variables.now!)}`)

  // ========== 阶段 7：上下文快照渲染（renderContextSnapshot） ==========
  console.log('\n--- 阶段7：renderContextSnapshot() 渲染动态上下文快照 ---')
  const snapshot = renderContextSnapshot(assembly)
  snapshot.split('\n').forEach(line => console.log(`    ${line}`))

  // ========== 验证：区段排序与重复注册拒绝 ==========
  console.log('\n--- 验证：重复注册同名区段应被拒绝 ---')
  try {
    ctx.systemPrompt.section({ name: 'task', order: 100, text: '重复' })
    console.log('  → ?? 未拒绝（不应该）')
  } catch (e: any) {
    console.log(`  → 被拒绝: ${e?.message ?? String(e)}`)
  }

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
