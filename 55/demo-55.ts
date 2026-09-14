// demo-55.ts：dsh-desktop（桌面与 UI）——真实前端挂载 + 真实 UI 插件清单 + 沙箱协作演示
// 本实验使用 dsh 真实包：
//   - @deepseek-ai/dsh-host-webserver    WebServer：宿主 HTTP 服务
//   - @deepseek-ai/dsh-host-frontend-static  frontend-static：把 SPA dist 挂到 webserver 上（真实静态服务）
//   - @deepseek-ai/dsh-web                WebRuntime：真实 fetch 验证挂载结果
//   - @deepseek-ai/dsh-sandbox / dsh-sandbox-local：真实沙箱 provider（平台可用性探测）
// 桌面应用 = host（主进程/webserver）+ UI（前端插件）+ sandbox（工具执行隔离）。
// UI 触发 → 工具 → 沙箱执行的完整链路中，UI 触发端为确定性演示（标注 demo）。
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import WebRuntime from '@deepseek-ai/dsh-web'
import { name as fetchName, inject as fetchInject, apply as fetchApply } from '@deepseek-ai/dsh-web-fetch-http'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SANDBOX_UNAVAILABLE } from '@deepseek-ai/dsh-sandbox'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { name as connName, inject as connInject, apply as connApply } from '@deepseek-ai/dsh-client-connection'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  console.log('=== dsh-desktop：桌面与 UI（真实前端挂载 + UI 插件清单 + 沙箱协作）===\n')
  const root = new Context()

  // ========== 1. 真实：装配 WebServer + frontend-static ==========
  console.log('--- 1. 装配 WebServer + frontend-static ---')
  await root.plugin(WebServer as any, { host: '127.0.0.1', port: 0, compression: 'none' })
  await root.plugin(WebRuntime as any, {})
  await root.plugin({ name: fetchName, inject: fetchInject, apply: fetchApply } as any, { maxResponseBytes: 5e6, maxBodyChars: 1e5, timeoutMs: 8000, maxRedirects: 5 })
  // frontend-static 依赖 ctx.connection（authorizeIndex），补装配 credentials + client-connection
  await root.plugin(LocalCredentialProvider as any, {})
  await root.plugin({ name: connName, inject: connInject, apply: connApply } as any, {})
  console.log(`  → connection 服务: ${(root as any).connection ? '已装配' : '缺失'}`)
  const { name, inject, apply } = await import('@deepseek-ai/dsh-host-frontend-static')

  // 真实：生成最小 SPA dist
  const dist = join(process.cwd(), '.demo-55-dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><html><head><title>dsh-desktop demo</title></head><body><h1 id="app">DeepSeek Harness Desktop</h1><script src="/app.js"></script></body></html>')
  writeFileSync(join(dist, 'app.js'), 'document.getElementById("app").textContent += " · UI plugin loaded";')
  console.log(`  → SPA dist 已生成（${dist}/index.html, app.js）`)

  await root.plugin({ name, inject, apply }, { distIndex: join(dist, 'index.html') })
  const ws = (root as any).webServer
  const base = `http://${ws.host}:${ws.port}`
  console.log(`  → frontend-static 已挂载：${base}/（fallback=${ws.fallback !== undefined}）`)

  // ========== 2. 真实：HTTP 验证静态服务 ==========
  console.log('\n--- 2. 真实 GET：验证 index.html 由 frontend-static 服务 ---')
  // 注：web Seam 的 SSRF 防护会真实拦截 127.0.0.1（第49篇已验证 WEB_BLOCKED_URL），
  // 这里用进程内 node:http 直接请求，验证 frontend-static 本身的服务行为。
  const get = (path: string) => new Promise<any>(async (resolve, reject) => {
    const http = await import('node:http')
    const req = http.get({ host: ws.host, port: ws.port, path }, (res: any) => {
      let body = ''
      res.on('data', (c: Buffer) => (body += c.toString()))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
  })
  const r1 = await get('/')
  console.log(`  → GET / → status=${r1.status}, body=${r1.body.replace(/\s+/g, ' ').slice(0, 90)}`)
  const r2 = await get('/app.js')
  console.log(`  → GET /app.js → status=${r2.status}, body=${r2.body.slice(0, 60)}`)
  console.log('  → （对照：经 web Seam 访问同一地址会被真实拦截）')

  // ========== 3. 真实：UI 插件清单 ==========
  console.log('\n--- 3. 真实 UI 插件清单（node_modules 枚举 dsh-client-ui-*）---')
  const pkgRoot = join(process.cwd(), 'node_modules', '@deepseek-ai')
  const uiPlugins = readdirSync(pkgRoot).filter((p) => p.startsWith('dsh-client-ui-')).sort()
  console.log(`  → 共 ${uiPlugins.length} 个真实 UI 插件：`)
  for (const p of uiPlugins) console.log(`    · ${p}`)

  // ========== 4. 真实：沙箱 provider 探测 ==========
  console.log('\n--- 4. 真实：沙箱 provider（LocalSandboxProvider）探测 ---')
  try {
    const sb = new LocalSandboxProvider({ workspaceRoot: process.cwd() } as any)
    console.log(`  → provider 构造成功（平台探测结果决定 open 是否可用）`)
    try {
      await sb.open?.({} as any)
      console.log(`  → open 成功：沙箱可用（ctx.sandbox 就绪）`)
    } catch (e: any) {
      console.log(`  → open 受限: ${e?.code ?? e?.message ?? String(e)}`)
    }
  } catch (e: any) {
    console.log(`  → provider 不可用: ${e?.code ?? e?.message ?? String(e)}（SANDBOX_UNAVAILABLE=${SANDBOX_UNAVAILABLE}）`)
  }

  // ========== 5. 协作链路演示（UI 触发 → 工具 → 沙箱） ==========
  console.log('\n--- 5. 协作链路（演示：UI 按钮 → 命令 → 沙箱策略 → 回 UI）---')
  const policy = {
    writableRoots: ['.demo-55-dist'],
    deniedPaths: ['~/.ssh', '~/.aws'],
    allowedDomains: ['registry.npmjs.org'],
  }
  const runViaSandbox = (cmd: string) => {
    if (cmd.includes('~/.ssh') || cmd.includes('~/.aws')) return { ok: false, reason: 'denied by sandbox policy' }
    if (cmd.startsWith('npm install')) return { ok: true, out: 'installed 3 packages (demo)' }
    return { ok: true, out: 'ok (demo)' }
  }
  const uiActions = [
    { button: '重启服务', cmd: 'npm run restart' },
    { button: '查看密钥', cmd: 'cat ~/.ssh/id_rsa' },
  ] as const
  for (const a of uiActions) {
    const r = runViaSandbox(a.cmd)
    console.log(`  → [UI 按钮] ${a.button} → $ ${a.cmd} → ${JSON.stringify(r)}（UI 渲染为提示条，demo）`)
  }
  console.log('  → 真实链路：UI 插件（dsh-client-ui-*）→ 工具（tool-bash 等）→ 沙箱 provider 执行 → 事件回 UI')

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
