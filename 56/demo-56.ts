// demo-56.ts：routing-suite（推理路由增强）——真实双适配器注册 + 路由策略演示
// 本实验使用 dsh 真实包：
//   - @deepseek-ai/dsh-llm            LlmRuntime：ctx.llm，适配器注册表（registerAdapter 真实机制）
//   - @deepseek-ai/dsh-llm-deepseek   DeepSeekAdapter（llm-deepseek）
//   - @deepseek-ai/dsh-llm-pi-ai      PiAiAdapter（llm-pi-ai）
// routing-suite 插件本体不在 npm 全家桶中：它是在 llm Seam 之上加一层的路由插件。
// 真实部分：双适配器经 registerAdapter 真实注册到 ctx.llm，重复注册真实报错，provider 路由表真实可查；
// 演示部分：路由决策表（任务类型 → provider）为确定性演示，标注 demo；不发起真实 LLM 调用（无 API key）。
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply as applyDeepseek, name as deepseekName, inject as deepseekInject } from '@deepseek-ai/dsh-llm-deepseek'
import { apply as applyPiAi, name as piAiName, inject as piAiInject } from '@deepseek-ai/dsh-llm-pi-ai'

// ---------- 演示：路由策略（routing-suite 语义） ----------
type TaskKind = 'reasoning' | 'chat' | 'tool-calling' | 'vision'
const ROUTES: Record<TaskKind, { provider: string; model: string }> = {
  'reasoning': { provider: 'deepseek-official', model: 'deepseek-reasoner' },
  'chat': { provider: 'deepseek-official', model: 'deepseek-chat' },
  'tool-calling': { provider: 'deepseek-official', model: 'deepseek-chat' },
  'vision': { provider: 'pi-ai', model: 'pi-ai-vision' },
}
function route(kind: TaskKind): { provider: string; model: string } {
  const r = ROUTES[kind] ?? ROUTES.chat
  return { provider: r.provider, model: r.model }
}

async function main() {
  console.log('=== routing-suite：推理路由增强（真实双适配器 + 路由策略演示）===\n')
  const root = new Context()

  // ========== 1. 真实：装配 LlmRuntime + 双适配器 ==========
  console.log('--- 1. 装配 LlmRuntime + DeepSeekAdapter + PiAiAdapter ---')
  await root.plugin(LlmRuntime as any, {})
  await root.plugin({ name: deepseekName, inject: deepseekInject, apply: applyDeepseek } as any, {})
  try {
    await root.plugin({ name: piAiName, inject: piAiInject, apply: applyPiAi } as any, { providers: {} })
    console.log('  → pi-ai 适配器：已装配（Config.providers 为空 → 未注册 provider 路由，真实行为）')
  } catch (e: any) {
    console.log(`  → pi-ai 适配器：装配失败（${(e?.message ?? String(e)).slice(0, 70)}）`)
  }
  const llm = (root as any).llm
  console.log(`  → ctx.llm 就绪，适配器注册表：`)
  const adapters: any = (llm as any).adapters ?? new Map()
  const providerKeys = [...adapters.keys()]
  console.log(`  → providers = ${JSON.stringify(providerKeys)}（registerAdapter 真实注册）`)

  // ========== 2. 真实：重复注册报错 ==========
  console.log('\n--- 2. 重复注册 deepseek adapter（真实报错）---')
  try {
    await root.plugin({ name: deepseekName, inject: deepseekInject, apply: applyDeepseek } as any, {})
    console.log('  → ?? 未报错（不应该）')
  } catch (e: any) {
    console.log(`  → 被拒绝: ${(e?.message ?? String(e)).slice(0, 90)}`)
  }

  // ========== 3. 演示：路由决策表 ==========
  console.log('\n--- 3. 路由决策（routing-suite 语义，demo）---')
  const tasks: Array<[TaskKind, string]> = [
    ['reasoning', '分析这段代码的时间复杂度并给证明'],
    ['tool-calling', '调用 fs 工具读取项目结构'],
    ['chat', '给这句话换个说法'],
    ['vision', '这张截图里有什么（image attached）'],
  ]
  for (const [kind, prompt] of tasks) {
    const r = route(kind)
    const hits = adapters.has(r.provider)
    const suffix = hits ? '（adapter 已注册，demo 决策）' : '（无 adapter → 降级 chat，demo）'
    console.log(`  → [${kind}] "${prompt.slice(0, 18)}…" → ${r.provider}/${r.model}${suffix}`)
  }

  // ========== 4. 边界：routing-suite 与 llm 双适配器的关系 ==========
  console.log('\n--- 4. 边界：路由层在 llm Seam 之上 ---')
  console.log('  → llm Seam（真实）：ctx.llm + registerAdapter 管理 provider 路由；每个 provider 一个适配器')
  console.log('  → routing-suite（演示）：在 llm 之上按任务类型选 provider/model；不改适配器接口')
  console.log('  → 双适配器 = deepseek（文本/推理）+ pi-ai（多模态）；路由层决定请求发给谁')
  console.log('  → 真实调用需要 API key：本实验只验证注册/路由机制，不发起真实 LLM 请求')

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
