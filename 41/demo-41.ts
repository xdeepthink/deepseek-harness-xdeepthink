// demo-41.ts：attachment（附件接纳与持久化）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-attachment        AttachmentStore 服务定义：validateImage / saveImages / admitPromptContent
//   - @deepseek-ai/dsh-attachment-local  LocalAttachmentStore：真实落盘（内容寻址），图片校验 + 归一化
// 全程不手写模拟类：图片解码校验、尺寸/像素限额、归一化、内容寻址落盘全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import sharp from 'sharp'

// 用 sharp 真实生成两张 PNG（8x8 纯色），确保图片字节可被 dsh 解码校验
async function makePng(red: number, green: number, blue: number): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: red, g: green, b: blue } } }).png().toBuffer()
}

async function assemble(rootDir: string) {
  const root = new Context()
  await root.plugin(LocalAttachmentStore, { dshHome: rootDir })
  console.log(`[装配] ctx.attachments=${typeof root.attachments?.saveImages}`)
  return root
}

async function main() {
  console.log('=== dsh attachment：附件接纳与持久化（真实实现）===\n')
  const rootDir = process.cwd() + '/.demo-41-attachments'
  const ctx = await assemble(rootDir)

  // ========== 1. validateImage：合法图片通过校验 ==========
  console.log('--- 1. validateImage：校验一张真实 PNG（8x8）---')
  const redPng = await makePng(255, 0, 0)
  const greenPng = await makePng(0, 180, 0)
  await ctx.attachments.validateImage({ data: redPng, mediaType: 'image/png' })
  console.log(`  → 校验通过（图片被完整解码，${redPng.length} 字节）`)
  console.log(`  → imageLimits: maxImageBytes=${ctx.attachments.imageLimits.maxImageBytes}, maxImagePixels=${ctx.attachments.imageLimits.maxImagePixels}`)

  // ========== 2. 错误路径：伪造图片字节应被拒绝 ==========
  console.log('\n--- 2. 错误路径：伪造图片字节（非 PNG）应被拒绝 ---')
  try {
    await ctx.attachments.validateImage({ data: Buffer.from('这不是图片内容!!'), mediaType: 'image/png' })
    console.log('  → ?? 未拒绝（不应该）')
  } catch (e: any) {
    console.log(`  → 被拒绝: ${e instanceof AttachmentError ? `[${e.code}] ` : ''}${e?.message ?? String(e)}`)
  }

  // ========== 3. saveImages：批量保存并返回内容寻址引用 ==========
  console.log('\n--- 3. saveImages：批量保存 2 张图片（校验 + 归一化 + 落盘）---')
  const refs = await ctx.attachments.saveImages([
    { data: redPng, mediaType: 'image/png', displayName: 'red-dot.png' },
    { data: greenPng, mediaType: 'image/png', displayName: 'green-bar.png' },
  ])
  for (const ref of refs) {
    console.log(`  → attachmentId=${ref.attachmentId} mediaType=${ref.mediaType} bytes=${ref.bytes}`)
  }

  // ========== 4. 落盘验证 ==========
  console.log('\n--- 4. 落盘验证（内容寻址文件存在且可读回）---')
  const fs = await import('node:fs')
  const path = await import('node:path')
  for (const ref of refs) {
    const filePath = path.join(rootDir, 'attachments', 'v1', 'objects', ref.attachmentId.slice(7, 9), ref.attachmentId.slice(7))
    const exists = fs.existsSync(filePath)
    const size = exists ? fs.statSync(filePath).size : 0
    console.log(`  → ${ref.attachmentId}: 存在=${exists}, 磁盘字节=${size}`)
  }

  // ========== 5. admitPromptContent：把附件并入 Host prompt ==========
  console.log('\n--- 5. admitPromptContent：将图片附件并入消息内容（替换为持久引用）---')
  const admitted = await ctx.attachments.admitPromptContent([
    { kind: 'text', text: '请看这张图：' },
    { kind: 'image', attachment: refs[0] },
    { kind: 'text', text: '还有这张：' },
    { kind: 'image', attachment: refs[1] },
  ])
  for (const part of admitted) {
    console.log(`  → ${JSON.stringify(part).slice(0, 120)}`)
  }

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
