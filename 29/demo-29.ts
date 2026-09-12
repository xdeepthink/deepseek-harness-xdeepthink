// demo-29.ts（代码审查流水线——workflow DAG 依赖与并行执行）
// 演示 workflow 核心概念：DAG 依赖、并行执行、状态传递、错误处理

// ========== 类型定义 ==========

interface WorkflowStep {
  id: string
  name: string
  dependsOn: string[]
  timeout?: number
  onError?: 'fail' | 'skip'
}

interface WorkerResult {
  result: any
  status: 'success' | 'failed' | 'skipped'
  error?: string
  durationMs: number
}

// ========== 模拟 Worker（每个步骤的具体逻辑） ==========

class MockWorkers {
  /**
   * lint 步骤：模拟代码 lint 检查
   */
  async lint(state: Record<string, any>): Promise<WorkerResult> {
    const start = Date.now()
    await this.sleep(300)  // 模拟执行时间

    // 模拟结果：3 个 warning，0 个 error
    return {
      result: {
        lint: {
          passed: true,
          warnings: 3,
          errors: 0,
          output: '✖ 3 problems (0 errors, 3 warnings)',
        },
      },
      status: 'success',
      durationMs: Date.now() - start,
    }
  }

  /**
   * test 步骤：模拟单元测试
   */
  async test(state: Record<string, any>): Promise<WorkerResult> {
    const start = Date.now()
    await this.sleep(500)  // 测试通常比 lint 慢

    // 模拟结果：15/15 通过
    return {
      result: {
        test: {
          passed: true,
          total: 15,
          passedCount: 15,
          failedCount: 0,
          coverage: { lines: 85 },
        },
      },
      status: 'success',
      durationMs: Date.now() - start,
    }
  }

  /**
   * build 步骤：模拟项目构建
   */
  async build(state: Record<string, any>): Promise<WorkerResult> {
    const start = Date.now()
    await this.sleep(400)

    // 模拟结果：构建成功
    return {
      result: {
        build: {
          passed: true,
          output: 'Build completed successfully',
          outputSize: '2.4MB',
        },
      },
      status: 'success',
      durationMs: Date.now() - start,
    }
  }

  /**
   * review 步骤：模拟 AI 代码审查
   */
  async review(state: Record<string, any>): Promise<WorkerResult> {
    const start = Date.now()
    await this.sleep(600)  // AI 审查通常比较慢

    // 读取前面步骤的结果（状态传递）
    const { lint, test, build } = state

    return {
      result: {
        review: {
          passed: true,
          suggestions: 2,
          report: `# AI 代码审查报告

## 自动化检查结果
- Lint：${lint?.passed ? '✅ 通过' : '❌ 失败'}（${lint?.warnings} warnings）
- 测试：${test?.passed ? '✅ 通过' : '❌ 失败'}（${test?.passedCount}/${test?.total}）
- 构建：${build?.passed ? '✅ 通过' : '❌ 失败'}

## 改进建议
1. 建议补充错误处理——当前代码缺少边界情况的处理
2. 建议增加单元测试覆盖率——目前 85%，建议达到 90% 以上

## 总结
代码质量良好，可以合并。`,
        },
      },
      status: 'success',
      durationMs: Date.now() - start,
    }
  }

  /**
   * report 步骤：汇总生成最终报告
   */
  async report(state: Record<string, any>): Promise<WorkerResult> {
    const start = Date.now()
    await this.sleep(100)

    const { lint, test, build, review } = state

    const report = `
# 代码审查最终报告

## 项目信息
- 审查时间：${new Date().toLocaleString('zh-CN')}

## 自动化检查
| 检查项 | 状态 | 详情 |
|--------|------|------|
| Lint | ${lint?.passed ? '✅ 通过' : '❌ 失败'} | ${lint?.warnings} warnings |
| 测试 | ${test?.passed ? '✅ 通过' : '❌ 失败'} | ${test?.passedCount}/${test?.total} 通过 |
| 构建 | ${build?.passed ? '✅ 通过' : '❌ 失败'} | 成功 |

## AI 审查
${review?.report || '（审查未完成）'}

## 总结
- 自动化检查：${[lint, test, build].filter(r => r?.passed).length}/3 通过
- AI 审查：${review?.passed ? '已完成' : '未完成'}
- 整体评价：${lint?.passed && test?.passed && build?.passed ? '✅ 代码质量良好' : '⚠️ 存在需要修复的问题'}
`

    return {
      result: { report: { content: report, generatedAt: Date.now() } },
      status: 'success',
      durationMs: Date.now() - start,
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ========== 简化版 workflow 引擎 ==========

class SimpleWorkflowEngine {
  private steps: WorkflowStep[] = []
  private workers: Map<string, (state: any) => Promise<WorkerResult>> = new Map()
  private state: Record<string, any> = {}
  private stepResults: Map<string, WorkerResult> = new Map()

  /**
   * 注册 Worker
   */
  registerWorker(name: string, fn: (state: any) => Promise<WorkerResult>) {
    this.workers.set(name, fn)
  }

  /**
   * 定义工作流步骤
   */
  define(steps: WorkflowStep[]) {
    this.steps = steps
  }

  /**
   * 执行工作流（拓扑排序 + 并行执行）
   */
  async run(initialState: Record<string, any> = {}): Promise<{
    status: 'success' | 'failed'
    state: Record<string, any>
    stepResults: Record<string, WorkerResult>
    durationMs: number
  }> {
    const start = Date.now()
    this.state = { ...initialState }
    this.stepResults.clear()

    console.log('🚀 工作流开始执行')
    console.log(`   步骤数：${this.steps.length}`)

    // 计算每个步骤的入度
    const inDegree = new Map<string, number>()
    const dependents = new Map<string, string[]>()  // 依赖这个步骤的步骤列表

    for (const step of this.steps) {
      inDegree.set(step.id, step.dependsOn.length)
      for (const dep of step.dependsOn) {
        if (!dependents.has(dep)) dependents.set(dep, [])
        dependents.get(dep)!.push(step.id)
      }
    }

    // 初始可执行队列（入度为 0 的步骤）
    const readyQueue: string[] = []
    for (const step of this.steps) {
      if (inDegree.get(step.id) === 0) {
        readyQueue.push(step.id)
      }
    }

    console.log(`   初始可并行步骤：${readyQueue.join(', ')}`)

    // 执行循环
    let completed = 0
    const totalSteps = this.steps.length

    while (completed < totalSteps) {
      // 并行执行所有就绪的步骤
      const stepsToRun = readyQueue.splice(0, readyQueue.length)
      console.log(`\n▶️  并行执行 ${stepsToRun.length} 个步骤：${stepsToRun.join(', ')}`)

      const results = await Promise.all(
        stepsToRun.map(stepId => this.executeStep(stepId))
      )

      // 更新状态和依赖
      for (let i = 0; i < stepsToRun.length; i++) {
        const stepId = stepsToRun[i]
        const result = results[i]
        this.stepResults.set(stepId, result)
        completed++

        // 状态传递：把步骤输出合并到 state
        Object.assign(this.state, result.result)

        console.log(`   ✅ ${stepId} 完成（${result.durationMs}ms）`)

        // 更新依赖它的步骤的入度
        const deps = dependents.get(stepId) || []
        for (const dependentId of deps) {
          inDegree.set(dependentId, inDegree.get(dependentId)! - 1)
          if (inDegree.get(dependentId) === 0) {
            readyQueue.push(dependentId)
          }
        }
      }
    }

    const duration = Date.now() - start
    console.log(`\n✅ 工作流完成，总耗时：${duration}ms`)

    return {
      status: 'success',
      state: this.state,
      stepResults: Object.fromEntries(this.stepResults),
      durationMs: duration,
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(stepId: string): Promise<WorkerResult> {
    const step = this.steps.find(s => s.id === stepId)!
    const worker = this.workers.get(step.id)!

    console.log(`   [${stepId}] ${step.name}...`)

    try {
      const result = await worker(this.state)
      return result
    } catch (error: any) {
      console.error(`   [${stepId}] 失败：${error.message}`)
      return {
        result: {},
        status: 'failed',
        error: error.message,
        durationMs: 0,
      }
    }
  }
}

// ========== 主函数 ==========

async function main() {
  console.log('='.repeat(60))
  console.log('📋 代码审查流水线（workflow DAG 演示）')
  console.log('='.repeat(60))

  // 创建工作流引擎
  const engine = new SimpleWorkflowEngine()
  const workers = new MockWorkers()

  // 注册 Worker
  engine.registerWorker('lint', state => workers.lint(state))
  engine.registerWorker('test', state => workers.test(state))
  engine.registerWorker('build', state => workers.build(state))
  engine.registerWorker('review', state => workers.review(state))
  engine.registerWorker('report', state => workers.report(state))

  // 定义工作流步骤（DAG）
  // 依赖关系：
  //   lint, test, build 无依赖，可以并行执行
  //   review 依赖 lint, test, build
  //   report 依赖 review
  engine.define([
    { id: 'lint', name: '代码 Lint 检查', dependsOn: [] },
    { id: 'test', name: '单元测试', dependsOn: [] },
    { id: 'build', name: '项目构建', dependsOn: [] },
    { id: 'review', name: 'AI 代码审查', dependsOn: ['lint', 'test', 'build'] },
    { id: 'report', name: '生成审查报告', dependsOn: ['review'] },
  ])

  // 执行工作流
  const result = await engine.run({
    projectPath: '/path/to/project',
    reviewScope: 'all',
  })

  // 输出最终报告
  console.log('\n' + '='.repeat(60))
  console.log('📄 最终审查报告')
  console.log('='.repeat(60))
  console.log(result.state.report.content)

  // 打印执行统计
  console.log('='.repeat(60))
  console.log('📊 执行统计')
  console.log('='.repeat(60))
  console.log(`总耗时：${result.durationMs}ms`)
  console.log(`步骤数：${Object.keys(result.stepResults).length}`)
  console.log(`\n各步骤耗时：`)
  for (const [stepId, stepResult] of Object.entries(result.stepResults)) {
    console.log(`  - ${stepId}: ${stepResult.durationMs}ms (${stepResult.status})`)
  }

  console.log(`\n💡 关键点：`)
  console.log(`  1. lint/test/build 三个步骤无依赖，并行执行（节省时间）`)
  console.log(`  2. review 等三个都完成才执行（依赖关系）`)
  console.log(`  3. 状态自动传递——review 能读到 lint/test/build 的结果`)
  console.log(`  4. report 汇总所有步骤的输出，生成最终报告`)
}

main().catch(console.error)
