// demo-05.ts
import { Context, type Plugin } from '@deepseek-ai/cordis'

/** 计数器服务：inc() 自增并返回新值，get() 返回当前值 */
export interface Counter {
  inc(): number
  get(): number
}

// 让 ctx.counter / app.counter 拥有类型
declare module '@deepseek-ai/cordis' {
  interface Context {
    counter: Counter
  }
}

// 三种形态插件共用的计数逻辑（闭包保存状态）
function makeCounter(): Counter {
  let value = 0
  return {
    inc() {
      return ++value
    },
    get() {
      return value
    },
  }
}

// ── ① 函数形态：导出为一个 (ctx) => void ───────────────────────────
function counterAsFunction(ctx: Context) {
  ctx.provide('counter', makeCounter())
}

// ── ② 类形态：导出为一个 class，cordis 内部会 new (ctx) ──────────────
class CounterAsClass {
  constructor(ctx: Context) {
    ctx.provide('counter', makeCounter())
  }
}

// ── ③ 对象形态：导出为一个带 apply 的对象 ───────────────────────────
const counterAsObject = {
  name: 'counter-as-object',
  apply(ctx: Context) {
    ctx.provide('counter', makeCounter())
  },
}

// 在一个独立应用里注册对应形态，并跑一遍 inc / inc / get
async function runCase(title: string, tag: string, shape: Plugin): Promise<number[]> {
  console.log(`=== ${title} ===`)
  const app = new Context()
  await app.plugin(shape)
  const seq = [app.counter.inc(), app.counter.inc(), app.counter.get()]
  console.log(`  [${tag}] inc → ${seq[0]}`)
  console.log(`  [${tag}] inc → ${seq[1]}`)
  console.log(`  [${tag}] get → ${seq[2]}`)
  console.log()
  return seq
}

async function main() {
  const results: number[][] = []
  results.push(await runCase('函数插件', '函数', counterAsFunction))
  results.push(await runCase('类插件', '类', CounterAsClass))
  results.push(await runCase('对象插件', '对象', counterAsObject))

  const expected = results[0].join(', ')
  const normalized = results.every((seq) => seq.join(', ') === expected)
  console.log('=== 验证：三种形态注册的 counter 行为一致 ===')
  console.log(`  三者都返回 ${expected} → ${normalized ? '归一化成功' : '归一化失败'}`)
}

main()
