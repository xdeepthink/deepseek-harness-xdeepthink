// demo-26.ts（演示：沙箱隔离的核心概念）
// sandbox 不是独立 Seam——dsh 中没有 ctx.sandbox 服务
// 进程隔离是通过操作系统级别的机制实现的（bwrap、Landlock、Seatbelt 等）
// 这个 Demo 演示沙箱隔离的核心概念：文件系统白名单、网络白名单、资源限制

import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'

// === 沙箱策略 ===
interface SandboxPolicy {
  writableRoots: string[]      // 可读写目录
  readonlyRoots: string[]      // 只读目录
  deniedPaths: string[]        // 完全禁止访问的路径
  allowedDomains: string[]     // 允许访问的网络域名
  maxProcesses: number         // 最大子进程数
  memoryLimitMB: number        // 内存限制
  timeoutMs: number            // 超时时间
}

const defaultPolicy: SandboxPolicy = {
  writableRoots: ['/workspace', '/tmp'],
  readonlyRoots: ['/usr', '/etc', '/bin'],
  deniedPaths: ['~/.ssh', '~/.aws', '~/.gnupg', '/etc/shadow'],
  allowedDomains: ['github.com', 'registry.npmjs.org', 'pypi.org'],
  maxProcesses: 30,
  memoryLimitMB: 2048,
  timeoutMs: 7200000,
}

// === 沙箱执行器 ===
class SandboxedExecutor {
  private policy: SandboxPolicy
  private processCount = 0

  constructor(policy: Partial<SandboxPolicy> = {}) {
    this.policy = { ...defaultPolicy, ...policy }
  }

  // 路径检查：判断路径是否允许访问
  checkPath(path: string, mode: 'read' | 'write'): { allowed: boolean; reason?: string } {
    // 检查禁止访问的路径
    for (const denied of this.policy.deniedPaths) {
      if (path.startsWith(denied)) {
        return { allowed: false, reason: `路径 ${path} 在禁止访问列表中` }
      }
    }

    // 检查可写目录
    if (mode === 'write') {
      for (const writable of this.policy.writableRoots) {
        if (path.startsWith(writable)) {
          return { allowed: true }
        }
      }
      return { allowed: false, reason: `路径 ${path} 不在可写目录中` }
    }

    // 检查只读目录
    for (const readonly of this.policy.readonlyRoots) {
      if (path.startsWith(readonly)) {
        return { allowed: true }
      }
    }

    // 检查可写目录（读操作也允许）
    for (const writable of this.policy.writableRoots) {
      if (path.startsWith(writable)) {
        return { allowed: true }
      }
    }

    return { allowed: false, reason: `路径 ${path} 不在允许访问的目录中` }
  }

  // 域名检查
  checkDomain(domain: string): { allowed: boolean; reason?: string } {
    for (const allowed of this.policy.allowedDomains) {
      if (domain === allowed || domain.endsWith(`.${allowed}`)) {
        return { allowed: true }
      }
    }
    return { allowed: false, reason: `域名 ${domain} 不在白名单中` }
  }

  // 执行命令（简化版：只做策略检查）
  executeCommand(cmd: string): { success: boolean; output?: string; error?: string } {
    console.log(`[Sandbox] 执行命令: ${cmd}`)

    // 检查进程数
    if (this.processCount >= this.policy.maxProcesses) {
      return { success: false, error: `超过最大进程数 ${this.policy.maxProcesses}` }
    }

    // 检查敏感路径访问
    if (cmd.includes('.ssh') || cmd.includes('.aws')) {
      return { success: false, error: `命令访问了敏感路径，被沙箱拦截` }
    }

    this.processCount++
    return { success: true, output: `命令执行成功（模拟）` }
  }

  getStats() {
    return {
      processCount: this.processCount,
      maxProcesses: this.policy.maxProcesses,
      memoryLimitMB: this.policy.memoryLimitMB,
    }
  }
}

// === 演示主流程 ===
async function main() {
  console.log('=== 演示：沙箱隔离的核心概念 ===\n')

  const executor = new SandboxedExecutor({
    writableRoots: ['./workspace', './tmp'],
    deniedPaths: ['~/.ssh', '~/.aws'],
    allowedDomains: ['github.com', 'registry.npmjs.org'],
    maxProcesses: 5,
  })

  console.log('=== 测试路径访问 ===')
  const paths = [
    { path: './workspace/test.txt', mode: 'write' as const },
    { path: '~/.ssh/id_rsa', mode: 'read' as const },
    { path: '/usr/bin/node', mode: 'read' as const },
    { path: '/etc/passwd', mode: 'write' as const },
  ]

  for (const p of paths) {
    const result = executor.checkPath(p.path, p.mode)
    console.log(`  ${p.mode} ${p.path}: ${result.allowed ? '✅ 允许' : '❌ 拒绝'}`)
    if (result.reason) {
      console.log(`    原因: ${result.reason}`)
    }
  }

  console.log('\n=== 测试网络访问 ===')
  const domains = ['github.com', 'evil.com', 'registry.npmjs.org', 'pastebin.com']
  for (const domain of domains) {
    const result = executor.checkDomain(domain)
    console.log(`  ${domain}: ${result.allowed ? '✅ 允许' : '❌ 拒绝'}`)
    if (result.reason) {
      console.log(`    原因: ${result.reason}`)
    }
  }

  console.log('\n=== 测试命令执行 ===')
  const commands = [
    'ls -la ./workspace',
    'cat ~/.ssh/id_rsa',
    'npm install lodash',
    'curl https://evil.com',
  ]

  for (const cmd of commands) {
    const result = executor.executeCommand(cmd)
    console.log(`  $ ${cmd}`)
    console.log(`    ${result.success ? '✅ ' + result.output : '❌ ' + result.error}`)
  }

  console.log('\n=== 沙箱统计 ===')
  console.log(`  ${JSON.stringify(executor.getStats(), null, 2)}`)

  console.log('\n=== 演示完成 ===')
}

main().catch(console.error)
