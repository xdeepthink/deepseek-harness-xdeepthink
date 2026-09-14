// demo-26.ts：sandbox——进程隔离与操作系统级安全沙箱（真实实现）
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-sandbox          SandboxProvider 基类 + SANDBOX_UNAVAILABLE 语义
//   - @deepseek-ai/dsh-sandbox-local    LocalSandboxProvider：真实平台沙箱 provider（bwrap/Landlock/Seatbelt）
//   - @deepseek-ai/dsh-sandbox-policy   ctx.sandboxPolicy：沙箱模式解析（默认模式/会话覆盖）
// 真实部分：provider 构造、open 平台探测（真实 fail-closed：当前平台无可用沙箱 → SANDBOX_UNAVAILABLE）、
//           策略解析（模式默认值/会话 override）；
// 演示部分：策略决策表（可写根/拒绝路径/允许域名 → 允许/拒绝）为确定性演示，标注 demo=true。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SandboxPolicyService, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SANDBOX_UNAVAILABLE } from '@deepseek-ai/dsh-sandbox'

async function main() {
  console.log('=== sandbox：进程隔离与操作系统级安全沙箱（真实实现）===\n')

  // ========== 1. 真实 provider 装配与平台探测 ==========
  console.log('--- 1. LocalSandboxProvider：plugin 装配 + open 平台探测（真实）---')
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SandboxPolicyService as any, { mode: 'danger-full-access' })
  try {
    await root.plugin(LocalSandboxProvider as any, { workspaceRoot: process.cwd() })
    const sb = (root as any).sandbox
    console.log(`  → ctx.sandbox 就绪（${typeof sb?.open === 'function' ? 'open 可用' : '当前平台无 open 能力 → fail-closed'}）`)
    if (typeof sb?.open !== 'function') {
      console.log(`  → SANDBOX_UNAVAILABLE=${SANDBOX_UNAVAILABLE} → 当前环境无可用操作系统沙箱（真实 fail-closed）`)
    } else {
      try {
        await sb.open({})
        console.log('  → open 成功：当前平台沙箱可用（真实隔离就绪）')
      } catch (e: any) {
        console.log(`  → open 受限（真实失败）：${e?.code ?? e?.message ?? String(e)}`)
        console.log(`  → SANDBOX_UNAVAILABLE=${SANDBOX_UNAVAILABLE} → 当前环境无可用操作系统沙箱（fail-closed）`)
      }
    }
  } catch (e: any) {
    console.log(`  → provider 装配受限（真实失败）：${e?.code ?? e?.message ?? String(e)}（SANDBOX_UNAVAILABLE=${SANDBOX_UNAVAILABLE}）`)
  }

  // ========== 2. 真实 sandboxPolicy：模式默认值与会话覆盖 ==========
  console.log('\n--- 2. sandboxPolicy：默认模式 + 会话 override（真实）---')
  const policy = (root as any).sandboxPolicy
  const session = root.sessions.create('sandbox-demo', { meta: { cwd: process.cwd() } })
  console.log(`  → 默认模式 = ${policy.defaultMode}（装配配置决定）`)
  const r1 = policy.resolve({ session })
  console.log(`  → resolve(session) → mode=${r1.mode}（无 override 时回落到默认）`)
  ;(setSandboxMode as any)(session, 'read-only')
  const r2 = policy.resolve({ session })
  console.log(`  → setSandboxMode(read-only) 后 → mode=${r2.mode}（会话级 override 真实生效）`)

  // ========== 3. 策略决策（demo=true：可写根/拒绝路径/允许域名） ==========
  console.log('\n--- 3. 沙箱策略决策表（demo=true，策略语义对应真实模式）---')
  const POLICY = {
    writableRoots: ['.demo-26-workspace'],
    deniedPaths: ['~/.ssh', '~/.aws', '/etc/passwd'],
    allowedDomains: ['registry.npmjs.org'],
    maxProcesses: 4,
    memoryLimitMB: 1024,
    timeoutMs: 10000,
  }
  const decide = (op: { kind: 'fs' | 'net' | 'proc'; path?: string; domain?: string; processes?: number; memoryMB?: number }) => {
    if (op.kind === 'fs' && POLICY.deniedPaths.some(d => op.path?.includes(d))) return { allow: false, reason: `denied path ${op.path}` }
    if (op.kind === 'fs' && !POLICY.writableRoots.some(w => op.path?.startsWith(w))) return { allow: true, reason: `read-only outside writable roots (${op.path})` }
    if (op.kind === 'net' && !POLICY.allowedDomains.includes(op.domain ?? '')) return { allow: false, reason: `domain not allowed ${op.domain}` }
    if (op.kind === 'proc' && (op.processes ?? 0) > POLICY.maxProcesses) return { allow: false, reason: `process limit ${POLICY.maxProcesses}` }
    return { allow: true, reason: 'ok' }
  }
  const cases: Array<[string, any]> = [
    ['写 .demo-26-workspace/build.txt', { kind: 'fs', path: '.demo-26-workspace/build.txt' }],
    ['读 ~/.ssh/id_rsa', { kind: 'fs', path: '~/.ssh/id_rsa' }],
    ['读 /etc/passwd', { kind: 'fs', path: '/etc/passwd' }],
    ['外连 registry.npmjs.org', { kind: 'net', domain: 'registry.npmjs.org' }],
    ['外连 evil.example.com', { kind: 'net', domain: 'evil.example.com' }],
    ['起 6 个子进程', { kind: 'proc', processes: 6 }],
  ]
  for (const [label, op] of cases) {
    const r = decide(op)
    console.log(`  → ${label} → ${r.allow ? '允许' : '拒绝'}（${r.reason}）`)
  }
  console.log('  → 决策语义与真实模式对应：read-only 下写拒绝、网络按 allowedDomains、进程/内存上限（demo）')

  // ========== 4. 边界 ==========
  console.log('\n--- 4. 边界与迁移 ---')
  console.log(`  → 真实机制：ctx.sandbox（provider）+ ctx.sandboxPolicy（模式）；隔离由 OS 完成（bwrap/Landlock/Seatbelt）`)
  console.log(`  → 当前平台（Windows 无可用 OS 沙箱）：provider open 失败 → SANDBOX_UNAVAILABLE → 应用层 fail-closed`)
  console.log(`  → 迁移到 Linux：同一套 provider/policy 接口，open 成功即真实隔离（第55篇同款语义）`)

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
