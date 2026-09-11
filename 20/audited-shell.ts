// audited-shell.ts（自定义 shell 执行器：审计 + 危险命令拦截）
import { exec } from 'child_process'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'

const name = 'audited-shell'
const inject = []

// 危险命令模式
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+(\/|~|\*)/,
  /sudo\s+/,
  /curl.*\|.*bash/,
  /wget.*\|.*bash/,
  /mkfs/,
  /dd\s+if=/,
]

class AuditedShellExecutor extends ShellExecutor {
  private auditLog: Array<{
    timestamp: string
    cmd: string
    duration: number
    exitCode: number
    rejected: boolean
    reason?: string
  }> = []

  // 沙箱模式（permission-presets 要求必须有值）
  get sandboxMode() {
    return 'danger-full-access'
  }

  // 解析请求：填充默认值（workdir、timeout 等）
  resolve(request: any) {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 30000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64 * 1024,
      ...(request.env ? { env: request.env } : {}),
      ...(request.stdin !== undefined ? { stdin: request.stdin } : {}),
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  // 前台执行命令
  async run(spec: any) {
    const timestamp = new Date().toISOString()
    const start = Date.now()
    const cmd = spec.command

    // 1. 危险命令检查
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(cmd)) {
        const duration = Date.now() - start
        this.auditLog.push({
          timestamp, cmd, duration, exitCode: -1,
          rejected: true, reason: `匹配危险模式: ${pattern}`,
        })
        throw new Error(`命令被安全策略拒绝: ${cmd}`)
      }
    }

    // 2. 执行命令
    return new Promise((resolve) => {
      exec(cmd, {
        cwd: spec.workdir,
        timeout: spec.timeoutMs,
        maxBuffer: spec.stdoutMaxBytes,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
      }, (error, stdout, stderr) => {
        const duration = Date.now() - start
        const exitCode = error ? (error as any).code ?? 1 : 0
        const timedOut = (error as any)?.killed && (error as any)?.signal === 'SIGTERM'

        // 3. 记录审计日志
        this.auditLog.push({
          timestamp, cmd, duration, exitCode, rejected: false,
        })

        console.log(`[Audit] ${timestamp} | ${duration}ms | exit=${exitCode} | ${cmd.slice(0, 80)}`)

        resolve({
          exitCode,
          signal: null,
          timedOut,
          aborted: false,
          timeoutMs: spec.timeoutMs,
          stdout: { text: stdout.toString(), truncated: false },
          stderr: { text: stderr.toString(), truncated: false },
        })
      })
    })
  }

  // 后台启动进程（简化版：先抛个错误，演示时只用到前台执行）
  start(spec: any) {
    throw new Error('audited-shell: start() 后台进程模式未实现，本演示仅支持前台 run()')
  }

  // 获取审计日志（调试用）
  getAuditLog() {
    return this.auditLog
  }
}

function apply(ctx: any, config: any = {}) {
  new AuditedShellExecutor(ctx)
}

export { name, inject, apply, AuditedShellExecutor }
