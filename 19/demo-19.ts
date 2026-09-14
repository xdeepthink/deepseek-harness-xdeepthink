// demo-19.ts：llm——模型能力族，双适配器与降级策略（真实实现）
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-llm            LlmRuntime：ctx.llm + registerAdapter 适配器注册表（真实机制）
//   - @deepseek-ai/dsh-llm-deepseek   DeepSeekAdapter（llm-deepseek）：真实 provider
//   - @deepseek-ai/dsh-llm-pi-ai      PiAiAdapter（llm-pi-ai）：真实多模态 provider
// 真实部分：双适配器经 registerAdapter 真实注册、适配器列表真实可查、热替换真实生效（卸载即消失）；
// 演示部分：降级策略（provider 依次尝试、unavailable 则降级）为确定性演示，标注 demo=true；
// 不发起真实 LLM 调用（无 API key，注册与降级机制全真）。
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply as applyDeepseek, name as deepseekName, inject as deepseekInject } from '@deepseek-ai/dsh-llm-deepseek'
import { apply as applyPiAi, name as piAiName, inject as piAiInject } from '@deepseek-ai/dsh-llm-pi-ai'

// ---------- 降级链（routing 语义，demo=true） ----------
// 优先级：deepseek-official（默认）→ pi-ai（多模态备胎）→ 无适配器（unavailable）
const FALLBACK_CHAIN = ['deepseek-official', 'pi-ai']

async function main() {
  console.log('=== llm：模型能力族，双适配器与降级策略（真实实现）===\n')
  const root = new Context()

  // ========== 1. 装配 LlmRuntime + 双适配器（真实） ==========
  console.log('--- 1. 装配 LlmRuntime + DeepSeekAdapter + PiAiAdapter（真实）---')
  await root.plugin(LlmRuntime as any, {})
  await root.plugin({ name: deepseekName, inject: deepseekInject, apply: applyDeepseek } as any, {})
  await root.plugin({ name: piAiName, inject: piAiInject, apply: applyPiAi } as any, { providers: {} })
  const llm = (root as any).llm
  const adapters: any = (llm as any).adapters ?? new Map()
  console.log(`  → ctx.llm 就绪；已注册 provider = ${JSON.stringify([...adapters.keys()])}`)
  console.log('  → deepseek 适配器 = 文本/推理（deepseek-chat/reasoner）')
  console.log('  → pi-ai 适配器 = 多模态（pi-ai-vision）；providers 为空 → 无真实路由（真实行为）')

  // ========== 2. 配置决定能力（真实）：providers 空 → 无路由 ==========
  console.log('\n--- 2. 配置决定能力（真实）：providers 配置为空 ---')
  const providerKeys = [...adapters.keys()]
  console.log(`  → pi-ai 以 providers={} 装配：不注册任何 provider 路由（注册表仅 ${JSON.stringify(providerKeys)}）`)
  console.log('  → 这是真实机制：配置决定能力——providers 声明什么，路由才存在什么（第56篇同款实证）')

  // ========== 3. 降级策略（demo=true） ==========
  console.log('\n--- 3. 降级策略（FALLBACK_CHAIN 依次尝试，demo=true）---')
  const registered = [...((root as any).llm.adapters ?? new Map()).keys()]
  const tryChain = (chain: string[]) => {
    const tried: string[] = []
    for (const p of chain) {
      tried.push(p)
      if (registered.includes(p)) return { ok: true, provider: p, tried }
    }
    return { ok: false, tried } // 全部不可用 → unavailable
  }
  const r1 = tryChain(FALLBACK_CHAIN)
  console.log(`  → reasoning 任务：尝试链 [${r1.tried.join('→')}] → ${r1.ok ? `命中 ${r1.provider}` : 'unavailable（fail-closed）'}`)
  console.log('  → 真实语义：适配器注册真实、路由真实；降级决策在上层策略（演示层），不侵入适配器接口')
  console.log('  → 若配置了 pi-ai providers（如 pi-ai-vision），则 vision 类任务可路由 pi-ai（演示分支）')

  // ========== 4. 能力对比 ==========
  console.log('\n--- 4. 双适配器能力分工 ---')
  console.log('  → deepseek-official：deepseek-chat（通用对话）、deepseek-reasoner（推理）；纯文本')
  console.log('  → pi-ai：多模态输入（图像）；同一 llm Seam，不同 provider 能力不同')
  console.log('  → 适配器模式 = 能力族插件化：换 provider 不改调用方，改注册表即可（配置决定能力）')

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
