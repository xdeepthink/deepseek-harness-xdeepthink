// demo-25.ts（演示：循环检测与超时控制）
// guard 不是独立 Seam——dsh 中没有 ctx.guard 服务
// 循环检测和超时控制是通过事件监听 + 中间件模式实现的
// 这个 Demo 演示循环检测和渐进式干预的核心概念

import * as crypto from 'crypto'

// === 循环检测器 ===
class LoopDetector {
  private callHistory: Array<{
    toolName: string
    argsHash: string
    timestamp: number
    count: number
  }> = []

  private warningThreshold: number
  private delayThreshold: number
  private blockThreshold: number
  private timeWindowMs: number

  constructor(options: {
    warningThreshold?: number
    delayThreshold?: number
    blockThreshold?: number
    timeWindowMs?: number
  } = {}) {
    this.warningThreshold = options.warningThreshold ?? 3
    this.delayThreshold = options.delayThreshold ?? 5
    this.blockThreshold = options.blockThreshold ?? 8
    this.timeWindowMs = (options.timeWindowMs ?? 5) * 60 * 1000
  }

  check(toolName: string, args: any): {
    action: 'pass' | 'warn' | 'delay' | 'block'
    message?: string
    count: number
  } {
    const argsHash = this.hashArgs(args)
    const now = Date.now()

    // 清理过期记录
    this.callHistory = this.callHistory.filter(c =>
      (now - c.timestamp) < this.timeWindowMs
    )

    // 查找匹配的记录
    let record = this.callHistory.find(
      c => c.toolName === toolName && c.argsHash === argsHash
    )

    if (!record) {
      record = { toolName, argsHash, timestamp: now, count: 0 }
      this.callHistory.push(record)
    }

    record.count++
    record.timestamp = now

    // 渐进式干预
    if (record.count >= this.blockThreshold) {
      return {
        action: 'block',
        message: `检测到循环调用：你已经调用 ${toolName} ${record.count} 次（参数相同），结果没有变化。已阻断。`,
        count: record.count,
      }
    }

    if (record.count >= this.delayThreshold) {
      return {
        action: 'delay',
        message: `你已经调用 ${toolName} ${record.count} 次。执行将延迟。请考虑是否在循环。`,
        count: record.count,
      }
    }

    if (record.count >= this.warningThreshold) {
      return {
        action: 'warn',
        message: `你已经调用 ${toolName} ${record.count} 次。如果结果没有变化，请考虑不同的策略。`,
        count: record.count,
      }
    }

    return { action: 'pass', count: record.count }
  }

  private hashArgs(args: any): string {
    // 归一化：去空格、统一引号、排序
    const normalized = JSON.stringify(args, Object.keys(args).sort())
    return crypto.createHash('md5').update(normalized).digest('hex')
  }
}

// === 超时控制器 ===
class TimeoutController {
  async withTimeout<T>(
    toolName: string,
    execute: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`工具 ${toolName} 执行超时（${timeoutMs}ms），已终止。`))
      }, timeoutMs)

      execute().then(
        (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    })
  }
}

// === 演示主流程 ===
async function main() {
  console.log('=== 演示一：循环检测与渐进式干预 ===\n')

  const detector = new LoopDetector({
    warningThreshold: 3,
    delayThreshold: 5,
    blockThreshold: 8,
  })

  // 模拟 Agent 反复调用同一个工具（参数完全相同）
  const toolCalls = [
    { tool: 'bash', args: { cmd: 'find / -name config.txt' } },
    { tool: 'bash', args: { cmd: 'find / -name config.txt' } },
    { tool: 'bash', args: { cmd: 'find / -name config.txt' } },
    { tool: 'bash', args: { cmd: 'find / -name config.txt' } },
    { tool: 'bash', args: { cmd: 'find / -name config.txt' } },
    { tool: 'bash', args: { cmd: 'find / -name config.txt' } },
    { tool: 'bash', args: { cmd: 'find / -name config.txt' } },
    { tool: 'bash', args: { cmd: 'find / -name config.txt' } },
  ]

  for (const call of toolCalls) {
    const result = detector.check(call.tool, call.args)
    console.log(`第 ${result.count} 次调用: ${call.tool}("${call.args.cmd}")`)
    console.log(`  结果: ${result.action.toUpperCase()}`)
    if (result.message) {
      console.log(`  消息: ${result.message}`)
    }
    console.log()
  }

  console.log('=== 演示二：超时控制 ===\n')

  const controller = new TimeoutController()

  // 模拟一个会超时的操作
  try {
    await controller.withTimeout('slow-tool', async () => {
      await new Promise(resolve => setTimeout(resolve, 5000)) // 5 秒
      return '完成'
    }, 2000) // 2 秒超时
  } catch (e) {
    console.log(`预期的超时错误: ${(e as Error).message}`)
  }

  console.log('\n=== 演示完成 ===')
}

main().catch(console.error)
