// demo-54.ts：ModLens（多模态视觉）——真实工具机制 + 真实图片字节处理 + 演示视觉语义
// 本实验使用 dsh 真实包：
//   - @deepseek-ai/dsh-tools          defineTool / ToolRuntime：真实工具注册与执行
//   - @deepseek-ai/dsh-session          SessionStore：会话（工具执行上下文）
// ModLens 插件本体不在 npm 全家桶中（官方生态插件，挂在视觉 Seam 之上）。
// 本实验的真实部分：PNG 文件由 Node 真实生成（IHDR/IDAT/IEND + zlib deflate），
// visual_inspect 真实读取文件字节、校验 PNG magic、解析 IHDR 宽高/位深/颜色类型；
// 演示部分：图像内容理解（object/ocr/主色）按官方设计语义给出，文件头已标注。
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------- 真实：生成一张 64x32 纯色 PNG（真实字节流） ----------
function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}
function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8bit RGB
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0 // filter none
    for (let x = 0; x < width; x++) {
      const o = y * (1 + width * 3) + 1 + x * 3
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- 真实：PNG 字节解析（magic / IHDR） ----------
function parsePng(buf: Buffer) {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (buf[i] !== magic[i]) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  }
}

async function main() {
  console.log('=== ModLens：多模态视觉（真实工具 + 真实字节处理 + 演示语义）===\n')
  const root = new Context()
  await root.plugin(SessionStore)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  console.log(`[装配] sessions=${typeof (root as any).sessions?.create} tools=${typeof (root as any).tools?.register}`)

  // 真实：生成测试图并落盘
  const dir = join(process.cwd(), '.demo-54-lens')
  mkdirSync(dir, { recursive: true })
  const pngPath = join(dir, 'screenshot.png')
  const png = makePng(64, 32, [214, 48, 49])
  writeFileSync(pngPath, png)
  console.log(`  → 真实生成测试图 ${pngPath}（${png.length} 字节，PNG 由 zlib deflate 编码）`)

  const session = root.sessions.create('modlens-demo', { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session, ctx: root } as unknown as any

  // ========== 1. 真实工具定义 ==========
  console.log('\n--- 1. 视觉工具注册（defineTool）---')
  root.tools.register(defineTool({
    name: 'visual_inspect',
    description: '视觉理解入口：给定图片路径，返回尺寸等字节级事实（真实）与内容理解（演示语义，标注）。',
    parameters: {
      imagePath: { type: 'string', required: true, description: '本地图片路径' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean' }, error: { type: 'string' },
        pixels: { type: 'object', additionalProperties: true },
        understanding: { type: 'object', additionalProperties: true },
        demo: { type: 'boolean' },
      } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async (args: any) => {
      if (!existsSync(args.imagePath)) return { ok: false, error: 'no such file', demo: true }
      const buf = readFileSync(args.imagePath)
      const px = parsePng(buf)
      if (!px) return { ok: false, error: 'not a png (magic/IHDR check failed)', demo: true }
      // 字节级事实（真实解析）；内容理解（演示语义）
      const understanding = {
        objects: ['一杯咖啡', '笔记本电脑'],
        ocr: ['demo UI: ModLens Preview'],
        dominantColor: '#D63031',
        demo: true,
      }
      return { ok: true, pixels: px, understanding, demo: true }
    },
  }))
  root.tools.register(defineTool({
    name: 'lens_info',
    description: '镜头（视觉模型）配置查询。配置为演示常量，标注 demo。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { model: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' } }, demo: { type: 'boolean' } } },
      render: (_a: any, v: any) => JSON.stringify(v),
    },
    execute: async () => ({
      model: 'deepseek-vl (demo)',
      capabilities: ['describe', 'ocr', 'grounding'],
      demo: true,
    }),
  }))
  console.log('  → visual_inspect / lens_info 已注册')

  const execute = (name: string, arguments_: any) => (root as any).tools.execute({
    callId: `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    arguments: arguments_,
    agent,
    signal: new AbortController().signal,
  })

  // ========== 2. 真实：字节级解析 ==========
  console.log('\n--- 2. visual_inspect：真实 PNG 解析 ---')
  const r1 = await execute('visual_inspect', { imagePath: pngPath })
  const v1 = (r1 as any).value
  console.log(`  → ok=${v1.ok} pixels=${JSON.stringify(v1.pixels)}（IHDR 真实解析：64x32 RGB8）`)
  console.log(`  → understanding=${JSON.stringify(v1.understanding)}（演示语义，demo=true）`)

  // ========== 3. 演示：非 PNG 拒绝 ==========
  console.log('\n--- 3. 错误路径：非 PNG 文件 ---')
  const badPath = join(dir, 'notes.txt')
  writeFileSync(badPath, 'this is not an image')
  const r2 = await execute('visual_inspect', { imagePath: badPath })
  console.log(`  → ${JSON.stringify((r2 as any).value)}（magic/IHDR 校验真实执行）`)

  // ========== 4. 演示：镜头配置 ==========
  console.log('\n--- 4. lens_info：镜头配置（演示常量）---')
  const r3 = await execute('lens_info', {})
  console.log(`  → ${JSON.stringify((r3 as any).value)}`)

  // ========== 5. 边界：多模态在哪一层 ==========
  console.log('\n--- 5. 边界：多模态的接入位置 ---')
  console.log('  → Harness 会话/工具/事件流都是文本层；图像经视觉 Seam 交给视觉模型，结果以结构化文本回注上下文')
  console.log('  → ModLens 扮演“镜头”：image → visual model → structured text（描述/OCR/定位）→ 回注 LLM')

  console.log('\n=== 实验完成 ===')
  await (root as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
