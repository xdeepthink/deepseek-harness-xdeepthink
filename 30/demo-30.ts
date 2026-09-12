// demo-30.ts：跨会话目标追踪系统
// 演示 goal 的核心概念：状态机、里程碑、进度计算、持久化、上下文注入
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ========== 类型定义 ==========
type GoalStatus = 'draft' | 'active' | 'paused' | 'achieved' | 'archived'
type Priority = 'low' | 'medium' | 'high' | 'critical'

interface Milestone {
  id: string
  title: string
  achieved: boolean
  achievedAt?: number
}

interface Goal {
  id: string
  title: string
  description: string
  status: GoalStatus
  priority: Priority
  progress: number
  milestones: Milestone[]
  createdAt: number
  activatedAt?: number
  achievedAt?: number
  archivedAt?: number
  dueDate?: number
  progressHistory: Array<{ timestamp: number; progress: number; note?: string }>
}

// ========== GoalService 实现 ==========
class GoalService {
  private goals: Map<string, Goal> = new Map()
  private storagePath: string

  constructor(storagePath: string) {
    this.storagePath = storagePath
    this.load()
  }

  // 持久化：从文件加载
  private load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'))
        data.goals.forEach((g: Goal) => this.goals.set(g.id, g))
        console.log(`[GoalService] 已从 ${this.storagePath} 加载 ${this.goals.size} 个目标`)
      }
    } catch (e) {
      console.error(`[GoalService] 加载失败: ${e}`)
    }
  }

  // 持久化：保存到文件
  private save() {
    const data = {
      version: '1.0',
      goals: Array.from(this.goals.values()),
    }
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true })
    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  // 创建 goal
  create(title: string, description: string, priority: Priority = 'medium', milestones: string[] = [], dueDate?: number): Goal {
    const goal: Goal = {
      id: 'goal_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      title,
      description,
      status: 'draft',
      priority,
      progress: 0,
      milestones: milestones.map((title, i) => ({ id: 'm_' + i, title, achieved: false })),
      createdAt: Date.now(),
      dueDate,
      progressHistory: [],
    }
    this.goals.set(goal.id, goal)
    this.save()
    console.log(`[GoalService] 创建目标: ${title} (${goal.id})`)
    return goal
  }

  // 激活 goal
  activate(goalId: string) {
    const goal = this.goals.get(goalId)
    if (!goal) throw new Error(`Goal not found: ${goalId}`)
    goal.status = 'active'
    goal.activatedAt = Date.now()
    this.save()
    console.log(`[GoalService] 激活目标: ${goal.title}`)
  }

  // 暂停 goal
  pause(goalId: string) {
    const goal = this.goals.get(goalId)
    if (!goal) throw new Error(`Goal not found: ${goalId}`)
    goal.status = 'paused'
    this.save()
    console.log(`[GoalService] 暂停目标: ${goal.title}`)
  }

  // 恢复 goal
  resume(goalId: string) {
    const goal = this.goals.get(goalId)
    if (!goal) throw new Error(`Goal not found: ${goalId}`)
    goal.status = 'active'
    this.save()
    console.log(`[GoalService] 恢复目标: ${goal.title}`)
  }

  // 标记里程碑完成（自动更新进度）
  markMilestone(goalId: string, milestoneId: string, note?: string) {
    const goal = this.goals.get(goalId)
    if (!goal) throw new Error(`Goal not found: ${goalId}`)
    const milestone = goal.milestones.find(m => m.id === milestoneId)
    if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`)
    milestone.achieved = true
    milestone.achievedAt = Date.now()
    // 自动计算进度
    const achievedCount = goal.milestones.filter(m => m.achieved).length
    goal.progress = Math.round((achievedCount / goal.milestones.length) * 100)
    goal.progressHistory.push({ timestamp: Date.now(), progress: goal.progress, note: note || `里程碑完成: ${milestone.title}` })
    this.save()
    console.log(`[GoalService] 里程碑完成: ${milestone.title}，目标进度更新为 ${goal.progress}%`)
  }

  // 标记 goal 完成
  markAchieved(goalId: string) {
    const goal = this.goals.get(goalId)
    if (!goal) throw new Error(`Goal not found: ${goalId}`)
    goal.status = 'achieved'
    goal.achievedAt = Date.now()
    goal.progress = 100
    goal.milestones.forEach(m => { if (!m.achieved) { m.achieved = true; m.achievedAt = Date.now() } })
    this.save()
    console.log(`[GoalService] 目标完成: ${goal.title}`)
  }

  // 归档 goal
  archive(goalId: string) {
    const goal = this.goals.get(goalId)
    if (!goal) throw new Error(`Goal not found: ${goalId}`)
    goal.status = 'archived'
    goal.archivedAt = Date.now()
    this.save()
    console.log(`[GoalService] 归档目标: ${goal.title}`)
  }

  // 获取活跃目标
  getActive(): Goal[] {
    return Array.from(this.goals.values()).filter(g => g.status === 'active')
  }

  // 列出所有目标
  listAll() {
    console.log('\n=== 所有目标 ===')
    Array.from(this.goals.values()).forEach(g => {
      console.log(`  [${g.status}] ${g.title} [${g.priority}] - ${g.progress}%`)
      g.milestones.forEach(m => {
        console.log(`    ${m.achieved ? '✅' : '⬜'} ${m.title}`)
      })
    })
  }

  // 上下文注入摘要（生成给 LLM 看的上下文）
  getContextSummary(): string {
    const activeGoals = this.getActive()
    if (activeGoals.length === 0) {
      return '（当前没有活跃目标）'
    }
    let summary = '\n📋 活跃目标上下文：\n'
    activeGoals.forEach(g => {
      const remaining = g.milestones.filter(m => !m.achieved).map(m => m.title)
      summary += `\n• ${g.title}（${g.progress}%）[${g.priority}]\n`
      summary += `  剩余里程碑：${remaining.join('、')}\n`
    })
    return summary
  }
}

// ========== 主函数 ==========
async function main() {
  const storagePath = path.join(__dirname, 'demo-goals.json')
  // 清理之前的演示数据
  if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath)

  const service = new GoalService(storagePath)

  console.log('\n=== 1. 创建目标 ===')
  const goal1 = service.create(
    '完成 web 应用 MVP',
    '开发一个包含用户注册、内容发布、评论互动的 web 应用 MVP。',
    'high',
    ['需求分析', '数据库设计', '后端 API', '前端页面', '测试部署']
  )
  const goal2 = service.create(
    '学习 Rust 语言',
    '掌握 Rust 的核心概念（所有权、借用、生命周期），能写中等复杂度的命令行工具。',
    'medium',
    ['语法基础', '所有权与借用', '错误处理', '项目实战']
  )

  console.log('\n=== 2. 激活目标 ===')
  service.activate(goal1.id)
  service.activate(goal2.id)

  console.log('\n=== 3. 查看上下文注入（给 LLM 看的） ===')
  console.log(service.getContextSummary())

  console.log('\n=== 4. 推进目标1（标记里程碑完成） ===')
  service.markMilestone(goal1.id, 'm_0', '完成需求文档')
  service.markMilestone(goal1.id, 'm_1', '设计数据库表结构')
  service.markMilestone(goal1.id, 'm_2', '完成 REST API')

  console.log('\n=== 5. 暂停目标2（暂时不学习 Rust） ===')
  service.pause(goal2.id)

  console.log('\n=== 6. 查看上下文注入（目标2已暂停，不显示） ===')
  console.log(service.getContextSummary())

  console.log('\n=== 7. 模拟重启（重新加载，验证持久化） ===')
  const service2 = new GoalService(storagePath)
  console.log('重启后活跃目标:')
  service2.getActive().forEach(g => console.log(`  - ${g.title} [${g.priority}] ${g.progress}%`))

  console.log('\n=== 8. 恢复目标2 ===')
  service2.resume(goal2.id)

  console.log('\n=== 9. 完成目标1并归档 ===')
  service2.markMilestone(goal1.id, 'm_3', '完成前端页面')
  service2.markMilestone(goal1.id, 'm_4', '部署上线')
  service2.markAchieved(goal1.id)
  service2.archive(goal1.id)

  console.log('\n=== 10. 最终目标列表 ===')
  service2.listAll()

  // 清理演示数据
  if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath)
}

main().catch(console.error)
