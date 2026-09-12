// demo-28.ts（三 Agent 协作系统——researcher + coder + reviewer）
// 演示 subagent 的核心概念：任务委派、独立上下文、最小权限、结果传递

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// ========== 类型定义 ==========

interface AgentMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCall?: { name: string; args: any }
  toolResult?: string
}

interface AgentResult {
  success: boolean
  output: string
  steps: number
  durationMs: number
  childSessionId: string
}

interface AgentSpec {
  name: string
  description: string
  tools: string[]  // 可用工具列表（最小权限）
  model: string
  maxSteps: number
  timeout: number
}

// ========== 工具集（模拟） ==========

class Toolset {
  private workspace: string

  constructor(workspace: string) {
    this.workspace = workspace
  }

  // researcher 的工具
  async web_search(query: string): Promise<string> {
    console.log(`  [researcher] 🔍 web_search: "${query}"`)
    // 模拟搜索结果
    await this.sleep(200)
    return `搜索结果：关于"${query}"的前 3 条结果：
1. ${query} 是什么？——官方文档
2. ${query} 的使用教程——掘金
3. ${query} 的最佳实践——知乎`
  }

  async read_file(filePath: string): Promise<string> {
    const fullPath = path.join(this.workspace, filePath)
    console.log(`  [read_file] 📖 ${filePath}`)
    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      return content.slice(0, 500) + (content.length > 500 ? '\n... [截断]' : '')
    } catch {
      return `文件不存在: ${filePath}`
    }
  }

  // coder 的工具
  async write_file(filePath: string, content: string): Promise<string> {
    const fullPath = path.join(this.workspace, filePath)
    console.log(`  [write_file] ✏️  ${filePath} (${content.length} 字符)`)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf-8')
    return `文件已写入: ${filePath}`
  }

  async bash(command: string): Promise<string> {
    console.log(`  [bash] 💻 ${command}`)
    await this.sleep(100)
    // 模拟执行结果
    if (command.includes('node') && command.includes('.js')) {
      return `node:internal/modules/cjs/loader:1105\n  throw err;\n  ^\n\nError: Cannot find module`
    }
    return `命令执行成功: ${command}\n(模拟输出)`
  }

  // 执行工具
  async callTool(name: string, args: any): Promise<string> {
    switch (name) {
      case 'web_search': return this.web_search(args.query)
      case 'read_file': return this.read_file(args.file_path)
      case 'write_file': return this.write_file(args.file_path, args.content)
      case 'bash': return this.bash(args.command)
      default: return `未知工具: ${name}`
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ========== 模拟 Agent ==========

class MockAgent {
  private spec: AgentSpec
  private tools: Toolset
  private context: AgentMessage[] = []
  private sessionId: string

  constructor(spec: AgentSpec, tools: Toolset) {
    this.spec = spec
    this.tools = tools
    this.sessionId = `agent-${spec.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  get id(): string {
    return this.sessionId
  }

  async run(task: string, parentContext?: string): Promise<AgentResult> {
    const start = Date.now()
    let steps = 0

    console.log(`\n🤖 [${this.spec.name}] 开始任务: ${task}`)
    console.log(`   工具: ${this.spec.tools.join(', ')}`)
    console.log(`   模型: ${this.spec.model}，最大步数: ${this.spec.maxSteps}`)

    // 初始化上下文
    this.context = [{
      role: 'user',
      content: task + (parentContext ? `\n\n上下文（来自父 Agent）:\n${parentContext}` : ''),
    }]

    let output = ''

    // 模拟 Agent 的执行循环
    while (steps < this.spec.maxSteps) {
      steps++

      // 根据 Agent 角色，模拟不同的行为
      if (this.spec.name === 'researcher') {
        // researcher：先搜索，再总结
        if (steps === 1) {
          const result = await this.tools.callTool('web_search', { query: task })
          this.context.push({ role: 'assistant', content: '我需要搜索相关资料' })
          this.context.push({ role: 'tool', content: result })
        } else if (steps === 2) {
          const toolMsg = this.context.filter(m => m.role === 'tool').pop()
          output = `调研结果：\n${toolMsg?.content ?? '（无结果）'}\n\n结论：基于以上资料，建议实现一个简单的 TypeScript 函数。`
          break
        }
      } else if (this.spec.name === 'coder') {
        // coder：先读任务，再写代码，再测试
        if (steps === 1) {
          output = `我来实现这个功能。`
        } else if (steps === 2) {
          const code = `// hello.ts\nexport function hello(name: string): string {\n  return \`Hello, \${name}!\`\n}\n\nconsole.log(hello('World'))`
          const result = await this.tools.callTool('write_file', { file_path: 'src/hello.ts', content: code })
          this.context.push({ role: 'tool', content: result })
        } else if (steps === 3) {
          const result = await this.tools.callTool('bash', { command: 'npx tsx src/hello.ts' })
          this.context.push({ role: 'tool', content: result })
          output = `代码已实现并测试。\n文件: src/hello.ts\n测试结果: 模拟输出（实际执行会有错误）`
          break
        }
      } else if (this.spec.name === 'reviewer') {
        // reviewer：读代码，提审查意见
        if (steps === 1) {
          output = `我来审查代码质量。`
        } else if (steps === 2) {
          const result = await this.tools.callTool('read_file', { file_path: 'src/hello.ts' })
          this.context.push({ role: 'tool', content: result })
        } else if (steps === 3) {
          output = `审查意见：\n1. ✅ 函数命名清晰\n2. ✅ 类型定义正确\n3. ⚠️ 缺少单元测试\n4. ⚠️ 缺少错误处理\n\n总体评价：代码质量良好，但建议补充测试。`
          break
        }
      }
    }

    const duration = Date.now() - start
    console.log(`🤖 [${this.spec.name}] 完成，步数: ${steps}，用时: ${duration}ms`)

    return {
      success: steps < this.spec.maxSteps,
      output,
      steps,
      durationMs: duration,
      childSessionId: this.sessionId,
    }
  }
}

// ========== 主 Agent（编排者） ==========

class Orchestrator {
  private workspace: string

  constructor(workspace: string) {
    this.workspace = workspace
  }

  async runTask(task: string): Promise<void> {
    console.log('='.repeat(60))
    console.log(`📋 主 Agent 收到任务: ${task}`)
    console.log('='.repeat(60))

    const toolset = new Toolset(this.workspace)

    // 定义三个子 Agent（不同工具集，最小权限）
    const researcherSpec: AgentSpec = {
      name: 'researcher',
      description: '负责调研，只有搜索和读文件权限',
      tools: ['web_search', 'read_file'],  // 不能写文件，不能执行命令
      model: 'gpt-4o-mini',
      maxSteps: 30,
      timeout: 300000,
    }

    const coderSpec: AgentSpec = {
      name: 'coder',
      description: '负责写代码，有读写文件和执行命令权限',
      tools: ['read_file', 'write_file', 'bash'],  // 可以写，可以执行
      model: 'gpt-4o',
      maxSteps: 50,
      timeout: 600000,
    }

    const reviewerSpec: AgentSpec = {
      name: 'reviewer',
      description: '负责审查，只有读文件权限',
      tools: ['read_file'],  // 不能写，不能执行命令
      model: 'gpt-4o',
      maxSteps: 30,
      timeout: 300000,
    }

    // ===== 第一步：委派 researcher 调研 =====
    console.log('\n' + '─'.repeat(60))
    console.log('📌 第一步：委派 researcher 调研')
    const researcher = new MockAgent(researcherSpec, toolset)
    const researchResult = await researcher.run(task)
    console.log('\n📝 researcher 输出:')
    console.log(researchResult.output)

    // ===== 第二步：委派 coder 实现 =====
    console.log('\n' + '─'.repeat(60))
    console.log('📌 第二步：委派 coder 实现代码')
    const coder = new MockAgent(coderSpec, toolset)
    const codeResult = await coder.run(
      task,
      `调研结果：\n${researchResult.output}`  // 把调研结果传给 coder
    )
    console.log('\n📝 coder 输出:')
    console.log(codeResult.output)


    // ===== 第三步：委派 reviewer 审查 =====
    console.log('\n' + '─'.repeat(60))
    console.log('📌 第三步：委派 reviewer 审查代码')
    const reviewer = new MockAgent(reviewerSpec, toolset)
    const reviewResult = await reviewer.run(
      '审查 src/hello.ts 的代码质量',
      `代码文件已创建: src/hello.ts\n请审查代码质量。`
    )
    console.log('\n📝 reviewer 输出:')
    console.log(reviewResult.output)

    // ===== 汇总结果 =====
    console.log('\n' + '='.repeat(60))
    console.log('✅ 任务完成汇总')
    console.log('='.repeat(60))
    console.log(`任务: ${task}`)
    console.log(`\n子 Agent 1: researcher`)
    console.log(`  会话ID: ${researchResult.childSessionId}`)
    console.log(`  步数: ${researchResult.steps}`)
    console.log(`  用时: ${researchResult.durationMs}ms`)
    console.log(`  工具: ${researcherSpec.tools.join(', ')}`)

    console.log(`\n子 Agent 2: coder`)
    console.log(`  会话ID: ${codeResult.childSessionId}`)
    console.log(`  步数: ${codeResult.steps}`)
    console.log(`  用时: ${codeResult.durationMs}ms`)
    console.log(`  工具: ${coderSpec.tools.join(', ')}`)

    console.log(`\n子 Agent 3: reviewer`)
    console.log(`  会话ID: ${reviewResult.childSessionId}`)
    console.log(`  步数: ${reviewResult.steps}`)
    console.log(`  用时: ${reviewResult.durationMs}ms`)
    console.log(`  工具: ${reviewerSpec.tools.join(', ')}`)

    console.log(`\n💡 关键点:`)
    console.log(`  1. 每个子 Agent 有独立会话，互不干扰`)
    console.log(`  2. 每个子 Agent 有不同工具集（最小权限）`)
    console.log(`  3. 结果可以传递：researcher → coder → reviewer`)
    console.log(`  4. 不同角色用不同模型：researcher 用 gpt-4o-mini（便宜）`)
    console.log(`  5. 每个子 Agent 有资源限制（maxSteps），防止死循环`)
  }
}

// ========== 主函数 ==========

async function main() {
  // 创建临时工作目录
  const workspace = path.join(os.tmpdir(), `subagent-demo-${Date.now()}`)
  await fs.mkdir(workspace, { recursive: true })

  console.log(`工作目录: ${workspace}`)

  const orchestrator = new Orchestrator(workspace)
  await orchestrator.runTask('实现一个 hello world 函数，支持 TypeScript')

  // 清理工作目录
  await fs.rm(workspace, { recursive: true, force: true })
}

main().catch(console.error)
