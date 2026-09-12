
// 这个 Demo 演示两个核心概念：
// 1. 如何通过非交互式方式运行交互式程序（用 echo 管道）
// 2. 如何录制和回放命令执行过程

import { exec } from 'child_process'
import * as fs from 'fs'

// === 概念一：非交互式运行交互式程序 ===
// 很多程序（vim、top、mysql）是交互式的，需要标准输入
// 通过管道把输入喂给它们，就可以非交互式运行

function runNonInteractive(cmd: string, input: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, (error, stdout, stderr) => {
      resolve({ stdout, stderr })
    })
    child.stdin?.write(input)
    child.stdin?.end()
  })
}

// === 概念二：录制和回放命令执行 ===
interface RecordingEvent {
  time: number
  type: 'command' | 'stdout' | 'stderr' | 'exit'
  data: string
}

class CommandRecorder {
  private events: RecordingEvent[] = []
  private startTime: number

  constructor() {
    this.startTime = Date.now()
  }

  recordCommand(cmd: string) {
    this.events.push({
      time: Date.now() - this.startTime,
      type: 'command',
      data: cmd,
    })
    console.log(`[Recorder] $ ${cmd}`)
  }

  recordOutput(stdout: string, stderr: string) {
    if (stdout) {
      this.events.push({
        time: Date.now() - this.startTime,
        type: 'stdout',
        data: stdout,
      })
    }
    if (stderr) {
      this.events.push({
        time: Date.now() - this.startTime,
        type: 'stderr',
        data: stderr,
      })
    }
  }

  recordExit(code: number) {
    this.events.push({
      time: Date.now() - this.startTime,
      type: 'exit',
      data: String(code),
    })
  }

  async run(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.recordCommand(cmd)
    return new Promise((resolve) => {
      exec(cmd, (error, stdout, stderr) => {
        const exitCode = error ? (error as any).code ?? 1 : 0
        this.recordOutput(stdout, stderr)
        this.recordExit(exitCode)
        resolve({ stdout, stderr, exitCode })
      })
    })
  }

  save(path: string) {
    fs.writeFileSync(path, JSON.stringify({
      startTime: this.startTime,
      events: this.events,
    }, null, 2))
    console.log(`[Recorder] 录制已保存到 ${path}（${this.events.length} 个事件）`)
  }

  static replay(path: string) {
    const recording = JSON.parse(fs.readFileSync(path, 'utf-8'))
    console.log(`=== 命令执行回放 ===`)
    for (const event of recording.events) {
      const timeStr = `[${(event.time / 1000).toFixed(2)}s]`
      switch (event.type) {
        case 'command':
          console.log(`${timeStr} $ ${event.data}`)
          break
        case 'stdout':
          console.log(`${timeStr} ${event.data.trim().slice(0, 100)}`)
          break
        case 'stderr':
          console.log(`${timeStr} (stderr) ${event.data.trim().slice(0, 100)}`)
          break
        case 'exit':
          console.log(`${timeStr} exit code: ${event.data}`)
          break
      }
    }
  }
}

// 演示主流程
async function main() {
  console.log('=== 演示一：非交互式运行交互式程序 ===')
  // 用 echo 管道把输入喂给 sort 命令
  const result = await runNonInteractive('sort', 'banana\napple\ncherry\n')
  console.log('sort 输出:')
  console.log(result.stdout)

  console.log('\n=== 演示二：录制和回放命令执行 ===')
  const recorder = new CommandRecorder()

  await recorder.run('echo "Hello World"')
  await recorder.run('dir /b *.txt 2>nul || ls *.txt')
  await recorder.run('echo "录制完成"')

  recorder.save('./recording.json')

  console.log('\n=== 回放录制 ===')
  CommandRecorder.replay('./recording.json')
}

main().catch(console.error)