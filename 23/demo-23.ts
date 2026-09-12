// demo-23.ts（演示：进程管理、资源限制与生命周期记录）
// subprocess 不是独立 Seam——它是 shell 内部的服务，通过 ctx.subprocess.spawn() 调用
// 这个 Demo 演示进程管理的核心概念：进程启动、资源限制、生命周期记录、进程数量限制
// 为了跨平台兼容，这里用 Node.js 内部模拟进程，不依赖外部 sleep 命令

import * as fs from 'fs'

interface ProcessHandle {
  id: string
  status: 'running' | 'exited' | 'killed'
  exitCode?: number
  startedAt: number
  endedAt?: number
  timer?: NodeJS.Timeout
  runMs: number
}

class ProcessManager {
  private handles = new Map<string, ProcessHandle>()
  private lifecycleLog: Array<{ time: string; event: string; processId?: string; details?: string }> = []
  private maxProcesses: number
  private maxRuntime: number

  constructor(options: { maxProcesses?: number; maxRuntimeMs?: number } = {}) {
    this.maxProcesses = options.maxProcesses ?? 5
    this.maxRuntime = options.maxRuntimeMs ?? 10000 // 10 秒
  }

  private log(event: string, processId?: string, details?: string) {
    this.lifecycleLog.push({
      time: new Date().toISOString(),
      event,
      processId,
      details,
    })
    console.log(`[ProcessManager] ${event} ${processId ?? ''} ${details ?? ''}`)
  }

  async spawn(name: string, runMs: number): Promise<ProcessHandle> {
    // 进程数量限制
    const runningCount = [...this.handles.values()].filter(h => h.status === 'running').length
    if (runningCount >= this.maxProcesses) {
      this.log('spawn_rejected', undefined, `超过最大进程数 ${this.maxProcesses}`)
      throw new Error(`Too many running processes (max ${this.maxProcesses})`)
    }

    const id = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    const handle: ProcessHandle = {
      id,
      status: 'running',
      startedAt: Date.now(),
      runMs,
    }

    // 进程模拟：用 setTimeout 模拟进程运行
    const timer = setTimeout(() => {
      handle.status = 'exited'
      handle.exitCode = 0
      handle.endedAt = Date.now()
      this.log('exit', id, `code=0 (模拟进程运行了 ${runMs}ms)`)
    }, runMs)

    handle.timer = timer

    this.handles.set(id, handle)
    this.log('spawn', id, `${name} (运行 ${runMs}ms)`)

    return handle
  }

  kill(id: string) {
    const handle = this.handles.get(id)
    if (handle && handle.status === 'running') {
      clearTimeout(handle.timer)
      handle.status = 'killed'
      handle.endedAt = Date.now()
      this.log('kill', id, 'signal=SIGTERM')
    }
  }

  list(): ProcessHandle[] {
    return [...this.handles.values()]
  }

  saveLog(path: string) {
    fs.writeFileSync(path, JSON.stringify(this.lifecycleLog, null, 2))
    console.log(`[ProcessManager] 生命周期日志已保存到 ${path}（${this.lifecycleLog.length} 个事件）`)
  }
}

// 演示主流程
async function main() {
  const manager = new ProcessManager({ maxProcesses: 3, maxRuntimeMs: 5000 })

  console.log('=== 启动 3 个模拟进程 ===')
  await manager.spawn('task-a', 2000)
  await manager.spawn('task-b', 3000)
  await manager.spawn('task-c', 4000)

  console.log('\n=== 尝试启动第 4 个（应该被拒绝）===')
  try {
    await manager.spawn('task-d', 1000)
  } catch (e) {
    console.log(`预期的拒绝: ${(e as Error).message}`)
  }

  console.log('\n=== 等待进程退出 ===')
  await new Promise(resolve => setTimeout(resolve, 2500))

  console.log('\n=== 当前进程状态 ===')
  manager.list().forEach(h => {
    console.log(`  ${h.id}: ${h.status} (运行了 ${h.runMs}ms)`)
  })

  console.log('\n=== 保存生命周期日志 ===')
  manager.saveLog('./lifecycle.json')
}

main().catch(console.error)
