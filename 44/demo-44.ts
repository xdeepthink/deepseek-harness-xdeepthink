// demo-44.ts：skill（技能发现与加载）——DeepSeek Harness 真实实现
// 本实验直接使用 dsh 真实包：
//   - @deepseek-ai/dsh-skill             SkillRegistry（ctx.skills）：list / get，provider 目录合并与优先级
//   - @deepseek-ai/dsh-skill-filesystem  FileSystemSkillProvider：目录扫描、frontmatter 解析、正文加载
// 全程不手写模拟类：技能发现、元数据解析、正文读取全部由 dsh 真实代码完成。
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { apply as applySkillFs, name as skillFsName, inject as skillFsInject } from '@deepseek-ai/dsh-skill-filesystem'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// 先构造一个真实的 skill bundle（目录 + SKILL.md + frontmatter）
function buildSkillBundle(root: string) {
  const skillDir = join(root, 'demo-skill')
  mkdirSync(skillDir, { recursive: true })
  const skillMd = `---
name: demo-skill
description: 演示用技能：把一段文字转成清单
---
# Demo Skill

## 用法
当用户要求"把这段内容整理成清单"时使用。

## 步骤
1. 读取输入文本
2. 按要点拆分并编号输出
`
  writeFileSync(join(skillDir, 'SKILL.md'), skillMd, 'utf8')
  mkdirSync(join(skillDir, 'assets'), { recursive: true })
  writeFileSync(join(skillDir, 'assets', 'note.txt'), 'asset-demo', 'utf8')
  return skillDir
}

async function assemble(skillRoot: string) {
  const root = new Context()
  await root.plugin(SkillRegistry)
  await root.plugin({ name: skillFsName, inject: skillFsInject, apply: applySkillFs }, { customSkillDirs: [skillRoot], watch: false })
  console.log(`[装配] ctx.skills=${typeof root.skills?.list}`)
  return root
}

async function main() {
  console.log('=== dsh skill：技能发现与加载（真实实现）===\n')
  const skillRoot = process.cwd() + '/.demo-44-skills'
  buildSkillBundle(skillRoot)
  console.log(`  → 已构造技能包: ${skillRoot}/demo-skill/SKILL.md（frontmatter + 正文 + assets）`)
  const ctx = await assemble(skillRoot)

  // ========== 1. 技能发现（list） ==========
  console.log('\n--- 1. ctx.skills.list()：发现技能（含文件系统 provider 的 demo-skill）---')
  const summaries = await ctx.skills.list()
  console.log(`  → 共 ${summaries.length} 个技能`)
  for (const s of summaries.filter(s => s.name === 'demo-skill')) {
    console.log(`  → ${s.name}: provider=${s.provider}, source=${s.source}, invocation=${JSON.stringify(s.invocation)}`)
    console.log(`    description: ${s.description}`)
  }

  // ========== 2. 技能加载（get） ==========
  console.log('\n--- 2. ctx.skills.get("demo-skill")：加载完整定义（正文）---')
  const def = await ctx.skills.get('demo-skill')
  if (def) {
    console.log(`  → name=${def.name}, content 前 120 字符: ${def.content.slice(0, 120)}`)
    console.log(`  → 正文总长 = ${def.content.length} 字符`)
  }

  // ========== 3. 无效技能名拒绝 ==========
  console.log('\n--- 3. 错误路径：非法技能名 / 不存在的技能 ---')
  const invalid = await ctx.skills.get('Not A Skill!')
  const missing = await ctx.skills.get('no-such-skill')
  console.log(`  → 非法名 get("Not A Skill!") = ${invalid}（未加载）`)
  console.log(`  → 不存在 get("no-such-skill") = ${missing}（未加载）`)

  // ========== 4. 运行时注册（register：代码内注册技能） ==========
  console.log('\n--- 4. ctx.skills.register()：运行时直接注册一个技能 ---')
  ctx.skills.register({ name: 'runtime-helper', description: '运行时注入的辅助技能', source: 'runtime', content: '当需要运行时辅助时使用。' })
  const runtimeSkill = await ctx.skills.get('runtime-helper')
  console.log(`  → 已注册并加载: ${runtimeSkill?.name}, content="${runtimeSkill?.content}"`)

  console.log('\n=== 实验完成 ===')
  await (ctx as any).fiber.dispose()
}

main().catch((err) => { console.error(err); process.exit(1) })
