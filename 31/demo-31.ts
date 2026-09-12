// demo-31.ts：Agent 自主规划与执行系统
// 演示 plan 的核心概念：步骤拆解、DAG依赖、并行执行、动态更新、重新规划
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ========== 类型定义 ==========
type StepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'
type PlanStatus = 'draft' | 'in_progress' | 'paused' | 'completed' | 'abandoned'

interface PlanStep {
  id: string
  title: string
  description?: string
  status: StepStatus
  order: number
  dependsOn: string[]
  estimatedMinutes: number
  actualMinutes?: number
  startedAt?: number
  completedAt?: number
  blockedReason?: string
}

interface Plan {
  id: string
  title: string
  description: string
  status: PlanStatus
  steps: PlanStep[]
  createdAt: number
  startedAt?: number
  completedAt?: number
  replanHistory: Array<{ timestamp: number; reason: string; oldStepCount: number; newStepCount: number }>
}

// ========== PlanService 实现 ==========
class PlanService {
  private plan: Plan | null = null

  // 创建 plan
  create(title: string, description: string, stepSpecs: Array<{ title: string; description?: string; dependsOn?: string[]; estimatedMinutes?: number }>): Plan {
    const steps: PlanStep[] = stepSpecs.map((spec, i) => ({
      id: 'step_' + i,
      title: spec.title,
      description: spec.description,
      status: 'pending',
      order: i,
      dependsOn: spec.dependsOn || [],
      estimatedMinutes: spec.estimatedMinutes || 30,
    }))

    this.plan = {
      id: 'plan_' + Date.now().toString(36),
      title,
      description,
      status: 'draft',
      steps,
      createdAt: Date.now(),
      replanHistory: [],
    }

    console.log(`[PlanService] 创建计划: ${title} (${steps.length} 个步骤)`)
    return this.plan
  }

  // 开始执行
  start() {
    if (!this.plan) throw new Error('No plan')
    this.plan.status = 'in_progress'
    this.plan.startedAt = Date.now()
    console.log(`[PlanService] 开始执行计划: ${this.plan.title}`)
  }

  // 获取下一个可执行的步骤（依赖都已完成的 pending 步骤）
  getNextSteps(): PlanStep[] {
    if (!this.plan) return []
    return this.plan.steps.filter(step => {
      if (step.status !== 'pending') return false
      return step.dependsOn.every(depId => {
        const dep = this.plan!.steps.find(s => s.id === depId)
        return dep && (dep.status === 'completed' || dep.status === 'skipped')
      })
    })
  }

  // 标记步骤开始
  markStepInProgress(stepId: string) {
    const step = this.getStep(stepId)
    step.status = 'in_progress'
    step.startedAt = Date.now()
    console.log(`[PlanService] 步骤开始: ${step.title}`)
  }

  // 标记步骤完成
  markStepDone(stepId: string, note?: string) {
    const step = this.getStep(stepId)
    step.status = 'completed'
    step.completedAt = Date.now()
    step.actualMinutes = step.startedAt ? (Date.now() - step.startedAt) / 60000 : 0
    console.log(`[PlanService] 步骤完成: ${step.title}${note ? ' (' + note + ')' : ''}`)
    this.checkPlanComplete()
  }

  // 标记步骤阻塞
  markStepBlocked(stepId: string, reason: string) {
    const step = this.getStep(stepId)
    step.status = 'blocked'
    step.blockedReason = reason
    console.log(`[PlanService] 步骤阻塞: ${step.title} (原因: ${reason})`)
  }

  // 添加步骤
  addStep(title: string, description?: string, afterStepId?: string): PlanStep {
    if (!this.plan) throw new Error('No plan')
    const newStep: PlanStep = {
      id: 'step_' + this.plan.steps.length + '_' + Date.now().toString(36),
      title,
      description,
      status: 'pending',
      order: this.plan.steps.length,
      dependsOn: [],
      estimatedMinutes: 30,
    }
    if (afterStepId) {
      const afterIndex = this.plan.steps.findIndex(s => s.id === afterStepId)
      this.plan.steps.splice(afterIndex + 1, 0, newStep)
      this.plan.steps.forEach((s, i) => s.order = i)
    } else {
      this.plan.steps.push(newStep)
    }
    console.log(`[PlanService] 添加步骤: ${title}`)
    return newStep
  }

  // 重新规划
  replan(reason: string, newStepSpecs: Array<{ title: string; description?: string; dependsOn?: string[] }>) {
    if (!this.plan) throw new Error('No plan')
    const oldStepCount = this.plan.steps.length
    // 保留已完成的步骤，替换未完成的
    const completedSteps = this.plan.steps.filter(s => s.status === 'completed' || s.status === 'skipped')
    const newSteps: PlanStep[] = newStepSpecs.map((spec, i) => ({
      id: 'step_new_' + i,
      title: spec.title,
      description: spec.description,
      status: 'pending',
      order: completedSteps.length + i,
      dependsOn: spec.dependsOn || [],
      estimatedMinutes: 30,
    }))
    this.plan.steps = [...completedSteps, ...newSteps]
    this.plan.replanHistory.push({
      timestamp: Date.now(),
      reason,
      oldStepCount,
      newStepCount: this.plan.steps.length,
    })
    console.log(`[PlanService] 重新规划: ${reason} (${oldStepCount} → ${this.plan.steps.length} 个步骤)`)
  }

  // 获取进度
  getProgress(): number {
    if (!this.plan || this.plan.steps.length === 0) return 0
    const completed = this.plan.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length
    return Math.round((completed / this.plan.steps.length) * 100)
  }

  // 生成上下文摘要
  getContextSummary(): string {
    if (!this.plan) return '（当前没有执行计划）'
    const progress = this.getProgress()
    const currentSteps = this.plan.steps.filter(s => s.status === 'in_progress')
    const nextSteps = this.getNextSteps()

    let summary = `## 当前执行计划\n\n`
    summary += `**${this.plan.title}**\n`
    summary += `进度: ${progress}% (${this.plan.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length}/${this.plan.steps.length} 步骤完成)\n\n`

    if (currentSteps.length > 0) {
      summary += `**当前步骤:**\n`
      currentSteps.forEach(s => summary += `- 🔵 ${s.title}\n`)
      summary += '\n'
    }

    if (nextSteps.length > 0) {
      summary += `**下一步:**\n`
      nextSteps.forEach(s => summary += `- ⬜ ${s.title}\n`)
      summary += '\n'
    }

    summary += `**全部步骤:**\n`
    this.plan.steps.forEach(s => {
      const icon = s.status === 'completed' ? '✅' : s.status === 'in_progress' ? '🔵' : s.status === 'blocked' ? '🚫' : s.status === 'skipped' ? '⏭️' : '⬜'
      summary += `${icon} ${s.order + 1}. ${s.title}${s.status === 'blocked' ? ' (阻塞: ' + s.blockedReason + ')' : ''}\n`
    })

    return summary
  }

  private getStep(stepId: string): PlanStep {
    if (!this.plan) throw new Error('No plan')
    const step = this.plan.steps.find(s => s.id === stepId)
    if (!step) throw new Error(`Step not found: ${stepId}`)
    return step
  }

  private checkPlanComplete() {
    if (!this.plan) return
    const allDone = this.plan.steps.every(s => s.status === 'completed' || s.status === 'skipped')
    if (allDone) {
      this.plan.status = 'completed'
      this.plan.completedAt = Date.now()
      console.log(`[PlanService] 计划完成: ${this.plan.title}`)
    }
  }
}

// ========== 模拟 Agent 执行 ==========
async function simulateAgentExecution() {
  const planService = new PlanService()

  console.log('\n=== 1. Agent 制定计划 ===')
  planService.create(
    '开发一个 web 应用 MVP',
    '包含用户注册、内容发布、评论互动的 web 应用',
    [
      { title: '需求分析', description: '和用户确认功能列表', estimatedMinutes: 30 },
      { title: '数据库设计', description: '设计表结构和关系', dependsOn: ['step_0'], estimatedMinutes: 45 },
      { title: '后端 API', description: '实现 REST API', dependsOn: ['step_1'], estimatedMinutes: 120 },
      { title: '前端页面', description: '实现前端界面', dependsOn: ['step_1'], estimatedMinutes: 90 },
      { title: '集成测试', description: '端到端测试', dependsOn: ['step_2', 'step_3'], estimatedMinutes: 60 },
      { title: '部署上线', description: '部署到服务器', dependsOn: ['step_4'], estimatedMinutes: 30 },
    ]
  )
  planService.start()

  console.log('\n=== 2. 查看计划摘要 ===')
  console.log(planService.getContextSummary())

  console.log('\n=== 3. 执行步骤 0: 需求分析 ===')
  const nextSteps1 = planService.getNextSteps()
  console.log(`可执行步骤: ${nextSteps1.map(s => s.title).join(', ')}`)
  planService.markStepInProgress('step_0')
  // 模拟执行...
  planService.markStepDone('step_0', '确认了用户注册、内容发布、评论互动三个核心功能')

  console.log('\n=== 4. 执行步骤 1: 数据库设计 ===')
  planService.markStepInProgress('step_1')
  planService.markStepDone('step_1', '设计了 users、posts、comments 三张表')

  console.log('\n=== 5. 发现可以并行执行后端和前端 ===')
  const nextSteps2 = planService.getNextSteps()
  console.log(`可执行步骤: ${nextSteps2.map(s => s.title).join(', ')} (可以并行!)`)

  console.log('\n=== 6. 执行中发现遗漏，添加步骤 ===')
  planService.addStep('配置 CI/CD', '配置持续集成和部署', 'step_3')
  console.log(`当前进度: ${planService.getProgress()}%`)

  console.log('\n=== 7. 执行步骤 2: 后端 API ===')
  planService.markStepInProgress('step_2')
  planService.markStepDone('step_2', '实现了用户认证、内容 CRUD、评论 API')

  console.log('\n=== 8. 前端步骤被阻塞 ===')
  planService.markStepInProgress('step_3')
  planService.markStepBlocked('step_3', '等待设计稿，用户还没提供 UI 设计')

  console.log('\n=== 9. 查看计划摘要（有阻塞步骤）===')
  console.log(planService.getContextSummary())

  console.log('\n=== 10. 发现原计划有重大问题，重新规划 ===')
  planService.replan(
    '用户需求变更：增加移动端适配，原计划没有考虑，需要重新规划',
    [
      { title: '前端页面（含移动端适配）', description: '响应式设计，适配桌面和移动端' },
      { title: '配置 CI/CD', description: '配置持续集成和部署' },
      { title: '集成测试', description: '端到端测试，包括移动端测试' },
      { title: '部署上线', description: '部署到服务器' },
    ]
  )
  console.log(`重新规划后进度: ${planService.getProgress()}%`)

  console.log('\n=== 11. 查看最终计划摘要 ===')
  console.log(planService.getContextSummary())

  console.log('\n=== 12. 重新规划历史 ===')
  console.log(JSON.stringify(planService['plan']!.replanHistory, null, 2))
}

simulateAgentExecution().catch(console.error)
