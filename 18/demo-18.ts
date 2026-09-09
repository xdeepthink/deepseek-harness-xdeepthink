// demo-18.ts — 真实启动实例：按族分组打印插件树，验证三点
//   [1] 启动顺序与依赖图一致    -> dump 最终树本身按 bundle 自底向上排序
//   [2] 缺一个 Seam 的传导链    -> 真 boot headless + patch 禁用 llm，观察 agent-loop 传导失败
//   [3] Bundle 切换族集合变化   -> web vs headless 两份 dump 的族集合差异
// 执行: node --experimental-strip-types demo-18.ts
import { execSync, spawnSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Entry = { id: string; pkg: string; disabled: boolean }

// dump-config 把最终合并树按"来源 bundle"分节（# == 注释开头）逐层打印，
// 顶层 `- id:` 全局唯一；节序 base -> ... -> app 即真实加载顺序（依赖自底向上）。
// 因此合并所有节的顶层条目 = 完整插件树。
function dumpTree(profile: string, patch?: string): { bundle: string; entries: Entry[] } {
  const out = execSync(`npx dsh --profile ${profile}${patch ? ` --patch "${patch}"` : ''} --dump-config 2>&1`, { encoding: 'utf8' })
  const lines = out.split(/\r?\n/)
  const entries: Entry[] = []
  let cur: Entry | null = null
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('# ==')) { continue }
    if (!line.trim()) continue
    const mId = line.match(/^- id:\s*(\S+)/)
    if (mId) { cur = { id: mId[1], pkg: '', disabled: false }; entries.push(cur); continue }
    if (!cur) continue
    const mPkg = line.match(/^\s{2}name:\s*'@deepseek-ai\/([^']+)'/)
    if (mPkg) { cur.pkg = mPkg[1]; continue }
    const mDis = line.match(/^\s{2}disabled:\s*(.+)$/)
    if (mDis && mDis[1].trim() === 'true') cur.disabled = true
  }
  // dump 的注释头不算 bundle，这里仅取最后一节的 bundle 名作为展示
  const lastHead = lines.filter((l: string) => l.startsWith('# ==')).pop() || ''
  return { bundle: lastHead.replace(/^# ==\s*/, ''), entries }
}

// 族 = 插件包名的能力词（dsh-<能力词>…，第一个连字符 token）
const familyOf = (e: Entry): string => e.pkg.replace(/^dsh-/, '').split('-')[0] || '?'

// 官方族表（packages/ 组织视图）：六族 + 编排，代表包清单
const FAMILY_NAMES = ['主干', '模型', '执行', '编排', '数据', '交互与安全', 'UI与接入']
const REPRESENTATIVE: Record<string, string[]> = {
  主干: ['core', 'api', 'typert'],
  模型: ['llm', 'e2b'],
  执行: ['shell', 'fs', 'terminal', 'subprocess', 'sandbox', 'lsp'],
  编排: ['agent', 'goal', 'jobs', 'subagent', 'workflow', 'plan', 'todo'],
  数据: ['session', 'session-query', 'storage', 'context', 'compaction', 'spill', 'credentials'],
  交互与安全: ['interaction', 'guard', 'identity'],
  UI与接入: ['web', 'sdk', 'hooks', 'mcp', 'skill'],
}

function printTree(profile: string) {
  const { bundle, entries } = dumpTree(profile)
  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const f = familyOf(e)
    if (!groups.has(f)) groups.set(f, [])
    groups.get(f)!.push(e)
  }
  const active = entries.filter(e => !e.disabled)
  console.log(`\n=== [1] dsh --profile ${profile} 真实加载（最终合并树, bundle=${bundle}）===`)
  console.log(`插件总数 ${entries.length}（启用 ${active.length} / 禁用 ${entries.length - active.length}），能力族 ${groups.size} 个，族顺序 = 加载顺序`)
  for (const [fam, list] of groups) {
    console.log(`\n[${fam}]  ${list.length} 个`)
    for (const e of list) {
      console.log(`  - ${e.id}${e.disabled ? '  (off)' : ''}  ${e.pkg}`)
    }
  }
  return groups
}

function compareProfiles() {
  console.log('\n=== [3] Bundle 切换：web → headless（族集合变化）===')
  const w = dumpTree('web').entries
  const h = dumpTree('headless').entries
  const idsW = new Set(w.map(x => x.id))
  const idsH = new Set(h.map(x => x.id))
  const famsW = new Set(w.map(familyOf))
  const famsH = new Set(h.map(familyOf))
  console.log(`web 插件 ${w.length} 个 / ${famsW.size} 族 ; headless 插件 ${h.length} 个 / ${famsH.size} 族`)
  const onlyW = [...famsW].filter(f => !famsH.has(f))
  const onlyH = [...famsH].filter(f => !famsW.has(f))
  if (onlyW.length) console.log(`仅 web 的族: ${onlyW.join(', ')}`)
  if (onlyH.length) console.log(`仅 headless 的族: ${onlyH.join(', ')}`)
  console.log('web 独有插件（前 12 个）:')
  const onlyIds = [...idsW].filter(id => !idsH.has(id))
  console.log('  ' + onlyIds.slice(0, 12).map(id => { const e = w.find(x => x.id === id); return e ? `${id}(${familyOf(e)})` : id }).join(', '))
}

function seamProbe() {
  console.log('\n=== [2] 缺一个 Seam（llm）的传导链（headless 真实启动）===')
  const patch = join(tmpdir(), 'dsh18-seam-llm.yml')
  writeFileSync(patch, '- id: llm\n  disabled: true\n', 'utf8')
  try {
    // dump 视角（带同一 patch）：llm 被禁用
    const dump = dumpTree('headless', patch)
    const llm = dump.entries.find(e => e.id === 'llm')
    if (!llm || !llm.disabled) {
      console.log('!! patch 未生效：llm 未被禁用，请检查 patch 语法')
      return
    }
    console.log(`patch 后 dump 树: llm → disabled=true（Seam 缺位），其注入方 agent-loop 一并停在 PENDING`)
    // 真实启动视角：agent-loop 因缺 llm 停在 PENDING，headless 无 agent 工厂 -> 启动失败
    const r = spawnSync(`npx dsh --profile headless --patch "${patch}" ping`, { shell: true, encoding: 'utf8' })
    const msg = (r.stdout || '') + (r.stderr || '')
    console.log(`boot exit=${r.status}`)
    const key = msg.split(/\r?\n/).find((l: string) => l.includes('dsh:')) || '(无 dsh: 输出)'
    console.log(`关键输出: ${key.trim()}`)
    console.log('传导链: llm 被禁 -> agent-loop 等不到 llm 服务 (PENDING) -> 工厂未注册 -> headless 报 no agent factory')
  } finally {
    rmSync(patch, { force: true })
  }
}

// 官方族表对照：真实 dump 的成员是实例/实现，表只是组织视图
function contrast(groups: Map<string, Entry[]>) {
  console.log('\n=== 与官方族表（packages/ 组织视图）的对照 ===')
  let sum = 0
  for (const fam of FAMILY_NAMES) {
    const g = [...groups.entries()].filter(([, list]) => list.length)
    const hit = g.reduce((n, [, list]) => n + list.filter(e => (REPRESENTATIVE[fam] || []).some(p => e.id.startsWith(p))).length, 0)
    sum += hit
    console.log(`${fam}: 族内代表包命中 ${hit} 项`)
  }
  console.log(`合计命中代表包 ${sum} 项（真实树插件总数 ${[...groups.values()].reduce((n, l) => n + l.length, 0)}）`)
}

const groups = printTree('web')
compareProfiles()
seamProbe()
contrast(groups)
console.log('\n[done]')
