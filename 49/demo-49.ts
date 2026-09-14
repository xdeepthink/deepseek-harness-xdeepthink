// demo-49.ts：web（网络访问 Seam 与 Web GUI 整合）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-web              WebRuntime：ctx.web 网络访问 Seam（search/fetch 双注册表、
//                                       与注册顺序无关的 provider 选择、WebError 错误分类）
//   - @deepseek-ai/dsh-web-fetch-http   HttpFetchProvider：匿名公网 HTTP(S) fetch provider，
//                                       DNS 解析后固定 IP 的 SSRF 防护（私有/环回地址拦截）
//   - @deepseek-ai/dsh-web-search-deepseek  DeepSeekSearchProvider：搜索 provider（需 API key）
//   - @deepseek-ai/dsh-host-webserver   WebServer：作为本地靶标，验证 WEB_BLOCKED_URL 防护
// 通过真实网络请求验证：注册表语义、SSRF 防护、provider 选择规则，全程无模拟（仅选择语义
// 演示用两个桩 provider 触发真实注册表/选择逻辑）。
import { Context } from '@deepseek-ai/cordis'
import WebRuntime, { WebError } from '@deepseek-ai/dsh-web'
import { apply as applyFetchHttp, name as fetchHttpName, inject as fetchHttpInject } from '@deepseek-ai/dsh-web-fetch-http'
import { apply as applySearchDeepseek, name as searchDeepseekName, inject as searchDeepseekInject } from '@deepseek-ai/dsh-web-search-deepseek'
import WebServer from '@deepseek-ai/dsh-host-webserver'

async function assemble() {
  const root = new Context()
  await root.plugin(WebRuntime as any, {})
  await root.plugin({ name: fetchHttpName, inject: fetchHttpInject, apply: applyFetchHttp } as any, { maxResponseBytes: 5e6, maxBodyChars: 1e5, timeoutMs: 8000, maxRedirects: 5 })
  await root.plugin({ name: searchDeepseekName, inject: searchDeepseekInject, apply: applySearchDeepseek } as any, {}) // 注册真实 DeepSeek 搜索 provider（调用才需要 key）
  await root.plugin(WebServer as any, { host: '127.0.0.1', port: 0, compression: 'none' })
  console.log(`[装配] ctx.web=${typeof (root as any).web?.search}，fetch provider=${(root as any).web?.fetchProviders?.size} 个，search provider=${(root as any).web?.searchProviders?.size} 个`)
  console.log(`[装配] WebServer=http://${(root as any).webServer.host}:${(root as any).webServer.port}（作为 SSRF 靶标）`)
  return root
}

// 选择语义演示用桩 provider（注册表与选择逻辑是真实 WebRuntime）
function stubProvider(id: string) {
  return {
    id,
    available: () => true,
    search: async (req: any) => ({
      sources: [{ url: `https://stub.local/${id}`, title: `stub provider ${id}`, query: req.query }],
    }),
  }
}

async function main() {
  console.log('=== dsh web：网络访问 Seam（真实实现）===\n')
  const ctx = await assemble()
  const web = (ctx as any).web
  const ws = (ctx as any).webServer
  const base = `http://${ws.host}:${ws.port}`

  // ========== 1. 注册表语义 ==========
  console.log('--- 1. 注册表：真实 provider 已在 ctx.web 中 ---')
  const fetchIds = [...web.fetchProviders.keys()]
  const searchIds = [...web.searchProviders.keys()]
  console.log(`  → fetch providers: ${JSON.stringify(fetchIds)}`)
  console.log(`  → search providers: ${JSON.stringify(searchIds)}`)

  // 重复注册 → WEB_DUPLICATE_PROVIDER
  console.log('  → 重复注册 fetch provider（应抛 WEB_DUPLICATE_PROVIDER）:')
  try {
    web.registerFetchProvider({ id: fetchIds[0], available: () => true, fetch: async () => ({}) })
    console.log('    ✗ 未抛错（异常）')
  } catch (e: any) {
    console.log(`    ✓ 抛错 code=${e.code ?? '?'} name=${e.name}`)
  }

  // ========== 2. SSRF 防护：环回地址被拦截 ==========
  console.log('\n--- 2. SSRF 防护：127.0.0.1 本地靶标被真实拦截 ---')
  try {
    await web.fetch({ url: `${base}/api/secret` })
    console.log('    ✗ 竟然访问成功（异常）')
  } catch (e: any) {
    console.log(`    ✓ ${e.code}: ${e.message}`)
  }

  // ========== 3. 公网 fetch ==========
  console.log('\n--- 3. 公网 fetch（https://example.com）---')
  try {
    const res = await web.fetch({ url: 'https://example.com/' })
    console.log(`  → statusCode=${res.statusCode} kind=${res.body?.kind} 字节=${res.body?.content?.length ?? 0} truncated=${res.truncated ?? false}`)
    if (res.body?.content) console.log(`  → 片段: ${res.body.content.slice(0, 60).replace(/\s+/g, ' ')}`)
  } catch (e: any) {
    console.log(`  → 公网不可达（演示环境限制）: ${e.code ?? e.message}`)
  }

  // ========== 4. 与注册顺序无关的 provider 选择 ==========
  console.log('\n--- 4. 选择语义（与注册顺序无关）---')
  web.registerSearchProvider(stubProvider('prov-a'))
  web.registerSearchProvider(stubProvider('prov-b'))
  // 无配置 + 多可用 → 歧义
  try {
    await web.search({ query: 'demo', maxResults: 3 })
    console.log('    ✗ 未抛歧义错误（异常）')
  } catch (e: any) {
    console.log(`  → 无配置 + 2 个可用 provider: ${e.code}`)
  }
  // 配置选中 prov-b（与注册顺序无关）
  ;(web as any).searchProviderId = 'prov-b'
  const sel = await web.search({ query: 'selected', maxResults: 1 })
  console.log(`  → 配置 searchProvider=prov-b: 命中 ${sel.sources[0].url}`)
  // 配置不存在的 id → CONFIGURED_MISSING
  ;(web as any).searchProviderId = 'prov-ghost'
  try {
    await web.search({ query: 'x', maxResults: 1 })
  } catch (e: any) {
    console.log(`  → 配置 searchProvider=prov-ghost: ${e.code}`)
  }

  // ========== 5. 搜索 provider 真实注册 ==========
  console.log('\n--- 5. DeepSeek 搜索 provider（真实注册，调用需 API key）---')
  console.log(`  → 已注册 id=${searchIds.includes('deepseek-official') ? 'deepseek-official' : JSON.stringify(searchIds)}`)
  console.log('  → 说明：真实搜索走 Anthropic 兼容 Messages + web_search_20250305 服务端工具，需要 DEEPSEEK_API_KEY，本演示不发起调用')

  // ========== 6. 资源限制：maxResponseBytes ==========
  console.log('\n--- 6. 资源限制（maxResponseBytes）---')
  const before = [...web.fetchProviders.keys()]
  ;(ctx as any).fiber.dispose()
  const ctx2 = new Context()
  await ctx2.plugin(WebRuntime as any, {})
  await ctx2.plugin({ name: fetchHttpName, inject: fetchHttpInject, apply: applyFetchHttp } as any, { maxResponseBytes: 128, maxBodyChars: 200, timeoutMs: 8000, maxRedirects: 5 })
  const web2 = (ctx2 as any).web
  try {
    const res = await web2.fetch({ url: 'https://example.com/' })
    console.log(`  → 128 字节上限：statusCode=${res.statusCode} bytes=${res.body?.content?.length ?? 0} truncated=${res.truncated ?? false}`)
  } catch (e: any) {
    console.log(`  → 128 字节上限：${e.code}`)
  }
  await (ctx2 as any).fiber.dispose()

  console.log('\n=== 实验完成 ===')
}

main().catch((err) => { console.error(err); process.exit(1) })
