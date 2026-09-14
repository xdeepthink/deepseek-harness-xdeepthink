// demo-48.ts：client（浏览器客户端连接通道）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-client-connection   Host HTTP bridge：RPC 通道（/rpc）+ Fetch 路由（/api）+ 浏览器认证
//   - @deepseek-ai/dsh-host-webserver      WebServer：承载 /rpc 与 /api 的真实 HTTP 服务器
//   - @deepseek-ai/dsh-credentials-local   LocalCredentialProvider：进程凭据（认证基础设施）
// 通过真实 HTTP 请求验证：认证拒绝、RPC 往返、错误路径、Fetch 路由，全程无模拟。
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { apply as applyConnection, name as connectionName, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'

async function assemble() {
  const root = new Context()
  await root.plugin(WebServer as any, { host: '127.0.0.1', port: 0, compression: 'none' })
  await root.plugin(LocalCredentialProvider as any, {})
  await root.plugin({ name: connectionName, inject: connectionInject, apply: applyConnection } as any, {})
  console.log(`[装配] WebServer=http://${(root as any).webServer.host}:${(root as any).webServer.port}，connection=${typeof (root as any).connection?.rpc?.handle}`)
  return root
}

async function main() {
  console.log('=== dsh client：浏览器客户端连接通道（真实实现）===\n')
  const ctx = await assemble()
  const ws = (ctx as any).webServer
  const connection = (ctx as any).connection
  const baseUrl = `http://${ws.host}:${ws.port}`

  // ========== 1. RPC 通道注册 ==========
  console.log('--- 1. RPC 通道注册（/rpc）---')
  const disposeRpc = await connection.rpc.handle('/rpc', async (endpoint: string, payload: unknown) => {
    if (endpoint === 'session.list') {
      return { ok: true, value: { sessions: ['sess-1', 'sess-2'], count: 2 } }
    }
    if (endpoint === 'echo') {
      return { ok: true, value: { echoed: payload } }
    }
    return { ok: false, error: { code: 'rpc/not-found', message: `unknown endpoint: ${endpoint}`, details: {} } }
  })
  console.log('  → /rpc 通道已注册（session.list / echo）')

  // ========== 1b. index 路由（浏览器入口，走 authorizeIndex 交换 cookie） ==========
  ws.register({
    kind: 'exact',
    path: '/',
    handler: (req: any, res: any) => {
      const ok = connection.authorizeIndex(req, res)
      if (!ok) return // authorizeIndex 已写响应（303 换 cookie 或 401）
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><body><h1>dsh client demo index</h1></body></html>')
    },
  })
  console.log('  → GET / index 路由已注册（authorizeIndex）')

  // ========== 2. Fetch 路由注册（/api 通道） ==========
  console.log('\n--- 2. Fetch 路由注册（/api/files）---')
  const disposeFetch = await connection.fetch.register({
    path: '/api/files',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const name = new URL(request.url).searchParams.get('name') ?? 'unknown'
      return new Response(JSON.stringify({ files: [`${name}.md`], total: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  console.log('  → /api/files (GET) 已注册')

  // ========== 3. 认证拒绝（无 token 请求） ==========
  console.log('\n--- 3. 认证边界：无 token 请求被拒绝 ---')
  const noToken = await fetch(`${baseUrl}/rpc/session.list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: 'session.list', payload: {} }),
  })
  console.log(`  → POST /rpc/session.list（无 token）: ${noToken.status} ${await noToken.text()}`)

  // ========== 4. 认证后 RPC 往返（浏览器 index 交换 cookie → 带 cookie 调用） ==========
  console.log('\n--- 4. 认证后 RPC 往返（浏览器 index 交换 cookie → 带 cookie 调用）---')
  const authUrl = connection.authenticatedUrl(baseUrl)
  const token = new URL(authUrl).searchParams.get('token')
  console.log(`  → authenticatedUrl 含 token = ${token !== null}`)

  // 浏览器第一步：GET /?token=... → 303 + Set-Cookie（dsh-auth-<authority>）
  const indexRes = await fetch(authUrl, { redirect: 'manual' })
  const setCookie = indexRes.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0]
  console.log(`  → GET /（带 token）: ${indexRes.status} 交换 cookie = ${cookie.slice(0, 42)}...`)

  const authedFetch = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie },
  })

  const rpcOk = await authedFetch('/rpc/session.list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-2', method: 'session.list', payload: {} }),
  })
  const rpcOkBody = await rpcOk.json()
  console.log(`  → POST /rpc/session.list: ${rpcOk.status} type=${rpcOkBody.type} result=${JSON.stringify(rpcOkBody.result)}`)

  const rpcEcho = await authedFetch('/rpc/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-3', method: 'echo', payload: { hello: 'client' } }),
  })
  const echoBody = await rpcEcho.json()
  console.log(`  → POST /rpc/echo: ${rpcEcho.status} result=${JSON.stringify(echoBody.result)}`)

  // ========== 5. 错误路径 ==========
  console.log('\n--- 5. 错误路径：未知 endpoint / method 不匹配 ---')
  const rpcMiss = await authedFetch('/rpc/no_such_endpoint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-4', method: 'no_such_endpoint', payload: {} }),
  })
  const missBody = await rpcMiss.json()
  console.log(`  → POST /rpc/no_such_endpoint: ${rpcMiss.status} result.ok=${missBody.result?.ok} error=${JSON.stringify(missBody.result?.error)}`)

  const badEnvelope = await authedFetch('/rpc/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'server-response', rpcId: 'rpc-5', result: {} }),
  })
  const badBody = await badEnvelope.json()
  console.log(`  → 非法信封（server-response 冒充）: ${badEnvelope.status} result=${JSON.stringify(badBody.result)}`)

  // ========== 6. Fetch 路由（/api） ==========
  console.log('\n--- 6. Fetch 路由调用（GET /api/files）---')
  const files = await authedFetch('/api/files?name=intro')
  const filesBody = await files.json()
  console.log(`  → GET /api/files?name=intro: ${files.status} result=${JSON.stringify(filesBody)}`)

  console.log('\n=== 实验完成 ===')
  await disposeRpc()
  await disposeFetch()
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
