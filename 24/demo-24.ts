// demo-24.ts（演示：代码符号搜索与调用链分析）
// lsp 不是独立 Seam——dsh 中没有 ctx.lsp 服务
// 代码理解能力是通过文件读取 + 正则分析 + tree-sitter 等方式实现的
// 这个 Demo 演示代码符号搜索和调用链分析的核心概念

import * as fs from 'fs'
import * as path from 'path'

// === 简单的符号搜索 ===
interface Symbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'const'
  file: string
  line: number
}

class CodeIndex {
  private symbols: Symbol[] = []
  private callGraph = new Map<string, Set<string>>() // caller -> callees

  // 扫描一个文件，提取所有符号
  scanFile(filePath: string) {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    lines.forEach((line, idx) => {
      const lineNum = idx + 1
      const trimmed = line.trim()

      // 匹配顶层函数定义
      const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/)
      if (funcMatch) {
        this.symbols.push({
          name: funcMatch[1],
          kind: 'function',
          file: filePath,
          line: lineNum,
        })
      }

      // 匹配类定义
      const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/)
      if (classMatch) {
        this.symbols.push({
          name: classMatch[1],
          kind: 'class',
          file: filePath,
          line: lineNum,
        })
      }

      // 匹配类方法（async method() 或 method()）
      const methodMatch = trimmed.match(/^(?:private\s+|public\s+|protected\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{?$/)
      if (methodMatch && !['if', 'for', 'while', 'switch', 'catch', 'function', 'class'].includes(methodMatch[1])) {
        this.symbols.push({
          name: methodMatch[1],
          kind: 'function',
          file: filePath,
          line: lineNum,
        })
      }

      // 匹配 const/let 赋值（箭头函数）
      const constMatch = trimmed.match(/^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/)
      if (constMatch) {
        this.symbols.push({
          name: constMatch[1],
          kind: 'function',
          file: filePath,
          line: lineNum,
        })
      }
    })
  }

  // 搜索符号
  searchSymbol(query: string): Symbol[] {
    return this.symbols.filter(s =>
      s.name.toLowerCase().includes(query.toLowerCase())
    )
  }

  // 构建调用图（简化版：找函数调用）
  buildCallGraph(filePath: string) {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    let currentFunction: string | null = null

    lines.forEach((line) => {
      const trimmed = line.trim()

      // 检查是不是函数定义（顶层函数）
      const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/)
      if (funcMatch) {
        currentFunction = funcMatch[1]
        this.callGraph.set(currentFunction, new Set())
        return
      }

      // 检查是不是类方法
      const methodMatch = trimmed.match(/^(?:private\s+|public\s+|protected\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{?$/)
      if (methodMatch && !['if', 'for', 'while', 'switch', 'catch', 'function', 'class'].includes(methodMatch[1])) {
        currentFunction = methodMatch[1]
        this.callGraph.set(currentFunction, new Set())
        return
      }

      // 检查函数调用
      if (currentFunction) {
        const callMatches = trimmed.matchAll(/(\w+)\s*\(/g)
        for (const match of callMatches) {
          const callee = match[1]
          // 排除关键字
          if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw'].includes(callee)) {
            this.callGraph.get(currentFunction)?.add(callee)
          }
        }
      }
    })
  }

  // 分析调用链
  analyzeCallChain(functionName: string): {
    callers: string[]
    callees: string[]
  } {
    // 找调用者（谁调用了这个函数）
    const callers: string[] = []
    for (const [caller, callees] of this.callGraph.entries()) {
      if (callees.has(functionName)) {
        callers.push(caller)
      }
    }

    // 找被调用者（这个函数调用了谁）
    const callees = [...(this.callGraph.get(functionName) ?? [])]

    return { callers, callees }
  }
}

// 演示主流程
async function main() {
  console.log('=== 演示：代码符号搜索与调用链分析 ===\n')

  // 创建一个示例代码文件
  const demoCode = `
class UserService {
  async getUser(id: string) {
    return await db.users.find(id)
  }

  async createUser(data: UserData) {
    await this.validateUser(data)
    const user = await db.users.insert(data)
    await emailService.sendWelcome(user.email)
    return user
  }

  private async validateUser(data: UserData) {
    if (!data.email) throw new Error('email required')
  }
}

class AuthService {
  async login(email: string, password: string) {
    const userService = new UserService()
    const user = await userService.getUser(email)
    await this.validatePassword(password, user)
    return user
  }

  private async validatePassword(pwd: string, user: any) {
    // 验证密码
  }
}
`

  const demoFile = './demo-code.ts'
  fs.writeFileSync(demoFile, demoCode)

  // 索引代码
  const index = new CodeIndex()
  index.scanFile(demoFile)
  index.buildCallGraph(demoFile)

  console.log('=== 符号搜索：搜索 "User" ===')
  const results = index.searchSymbol('User')
  results.forEach(s => {
    console.log(`  ${s.name} (${s.kind}) - ${s.file}:${s.line}`)
  })

  console.log('\n=== 调用链分析：分析 createUser ===')
  const chain = index.analyzeCallChain('createUser')
  console.log('  调用者:')
  chain.callers.forEach(c => console.log(`    - ${c}`))
  if (chain.callers.length === 0) console.log('    - (无)')
  console.log('  被调用者:')
  chain.callees.forEach(c => console.log(`    - ${c}`))

  // 清理
  fs.unlinkSync(demoFile)
  console.log('\n=== 演示完成 ===')
}

main().catch(console.error)
