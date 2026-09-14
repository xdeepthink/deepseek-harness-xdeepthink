// demo-47.ts：host（Web 宿主服务器）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-host-webserver  WebServer：node:http 路由注册（exact/prefix）、
//                                       fallback 席位、gzip、index 注入渲染（IndexInjection 表）
// 通过真实 HTTP 请求（node fetch）验证路由分发、fallback 与注入，全程无模拟。
import { Context } from '@deepseek-ai/cordis'
import WebServer, { renderIndexInjections } from '@deepseek-ai/dsh-host-webserver'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

async function assemble() {
  const root = new Context()
  await root.plugin(WebServer as any, { host: '127.0.0.1', port: 0, compression: 'gzip' })
  console.log(`[装配] WebServer 已监听: http://${(root as any).webServer.host}:${(root as any).webServer.port}`)
  return root
}

async function main() {
  console.log('=== dsh host：Web 宿主服务器（真实实现）===\n')
  const ctx = await assemble()
  const ws = (ctx as any).webServer as WebServer

  // ========== 1. 命名路由注册 ==========
  console.log('--- 1. 路由注册（exact + prefix）---')
  ws.register({
    kind: 'exact',
    path: '/api/health',
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, service: 'demo-47', time: Date.now() }))
    },
  })
  ws.register({
    kind: 'prefix',
    path: '/api/todos',
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ todos: [{ id: 1, content: '写第47篇实验', done: false }], path: req.url }))
    },
  })
  console.log('  → /api/health (exact) + /api/todos (prefix) 已注册')

  // ========== 2. index 注入（webserver/index-inject 事件 + renderIndex） ==========
  console.log('\n--- 2. index 注入（IndexInjection 表 + 事件收集）---')
  ;(ctx as any).on('webserver/index-inject', (table: IndexInjection[]) => {
    table.push({ kind: 'global', name: 'DSH_DEMO_47', value: { injectedBy: 'demo-47' } })
    table.push({ kind: 'script', placement: 'body', text: 'console.log("demo-47 injected")' })
  })
  const rows = ws.collectIndexInjections()
  console.log(`  → 注入行 ${rows.length} 条: ${JSON.stringify(rows)}`)
  const html = '<!doctype html><html><head></head><body><div id="app"></div></body></html>'
  const rendered = ws.renderIndex(html)
  console.log(`  → renderIndex 后 head 含注入 = ${rendered.includes('DSH_DEMO_47')}，body 含 script = ${rendered.includes('demo-47 injected')}`)
  console.log(`  → renderIndexInjections 独立渲染 = ${renderIndexInjections(html, rows).includes('globalThis["DSH_DEMO_47"]')}`)

  // ========== 3. fallback 席位（SPA 分发） ==========
  console.log('\n--- 3. fallback 席位（未匹配请求 → SPA index）---')
  ws.registerFallback((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(ws.renderIndex('<!doctype html><html><head><title>dsh-host</title></head><body>dsh fallback</body></html>'))
  })

  // ========== 4. 真实 HTTP 请求验证 ==========
  console.log('\n--- 4. 真实 HTTP 请求验证（node fetch）---')
  const base = `http://${ws.host}:${ws.port}`

  const health = await fetch(`${base}/api/health`)
  console.log(`  → GET /api/health: ${health.status} ${await health.text()}`)

  const todos = await fetch(`${base}/api/todos?page=2`)
  const todosBody = await todos.json()
  console.log(`  → GET /api/todos?page=2: ${todos.status} todos=${todosBody.todos.length} path=${todosBody.path}`)

  const fallback = await fetch(`${base}/some/spa/route`)
  const fb = await fallback.text()
  console.log(`  → GET /some/spa/route: ${fallback.status} 含注入=${fb.includes('DSH_DEMO_47')} 含标题=${fb.includes('dsh-host')}`)

  // gzip 验证（Accept-Encoding）
  const gz = await fetch(`${base}/api/health`, { headers: { 'accept-encoding': 'gzip' } })
  const gzBody = await gz.text()
  console.log(`  → GET /api/health (Accept-Encoding: gzip): ${gz.status} body=${gzBody} content-encoding=${gz.headers.get('content-encoding') ?? 'identity'}`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
