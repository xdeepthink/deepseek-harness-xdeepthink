// demo-32.ts：Agent 短期待办清单系统
import * as fs from 'fs'

// ========== 类型定义 ==========
type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'cancelled'
type Priority = 'high' | 'normal' | 'low'

interface TodoItem {
  id: string
  text: string
  description?: string
  status: TodoStatus
  priority: Priority
  order: number
  tags: string[]
  createdAt: number
  startedAt?: number
  completedAt?: number
  blockedReason?: string
  completionNote?: string
  planStepId?: string
  subTasks?: TodoItem[]
}

// ========== TodoService 实现 ==========
class TodoService {
  private todos: TodoItem[] = []
  private idCounter = 0

  // 批量替换（todo_write 的底层实现）
  replace(items: Array<{ text: string; status?: TodoStatus; priority?: Priority; tags?: string[]; planStepId?: string }>): TodoItem[] {
    this.todos = items.map((item, i) => ({
      id: 'todo_' + (++this.idCounter),
      text: item.text,
      status: item.status || 'pending',
      priority: item.priority || 'normal',
      order: i,
      tags: item.tags || [],
      createdAt: Date.now(),
      planStepId: item.planStepId,
    }))
    this.resort()
    console.log(`[TodoService] 批量替换: ${this.todos.length} 个待办`)
    return this.todos
  }

  // 添加
  add(text: string, priority: Priority = 'normal', tags: string[] = []): TodoItem {
    const todo: TodoItem = {
      id: 'todo_' + (++this.idCounter),
      text,
      status: 'pending',
      priority,
      order: this.todos.length,
      tags,
      createdAt: Date.now(),
    }
    this.todos.push(todo)
    this.resort()
    console.log(`[TodoService] 添加: ${text} (优先级: ${priority})`)
    return todo
  }

  // 标记完成
  markDone(todoId: string, note?: string) {
    const todo = this.get(todoId)
    todo.status = 'done'
    todo.completedAt = Date.now()
    todo.completionNote = note
    console.log(`[TodoService] 完成: ${todo.text}${note ? ' (' + note + ')' : ''}`)
  }

  // 标记进行中
  markInProgress(todoId: string) {
    const todo = this.get(todoId)
    todo.status = 'in_progress'
    todo.startedAt = Date.now()
    console.log(`[TodoService] 开始: ${todo.text}`)
  }

  // 标记阻塞
  markBlocked(todoId: string, reason: string) {
    const todo = this.get(todoId)
    todo.status = 'blocked'
    todo.blockedReason = reason
    console.log(`[TodoService] 阻塞: ${todo.text} (原因: ${reason})`)
  }

  // 更新
  update(todoId: string, patch: Partial<TodoItem>) {
    const todo = this.get(todoId)
    Object.assign(todo, patch)
    this.resort()
    console.log(`[TodoService] 更新: ${todo.text}`)
  }

  // 删除
  remove(todoId: string) {
    const todo = this.get(todoId)
    this.todos = this.todos.filter(t => t.id !== todoId)
    this.resort()
    console.log(`[TodoService] 删除: ${todo.text}`)
  }

  // 清空
  clear() {
    const count = this.todos.length
    this.todos = []
    console.log(`[TodoService] 清空: ${count} 个待办`)
  }

  // 重新排序（按优先级和 order）
  private resort() {
    const priorityOrder: Record<Priority, number> = { high: 0, normal: 1, low: 2 }
    this.todos.sort((a, b) => {
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority]
      }
      return a.order - b.order
    })
    this.todos.forEach((t, i) => t.order = i)
  }

  // 列表（可按标签过滤）
  list(filter?: { tag?: string; status?: TodoStatus }): TodoItem[] {
    let result = this.todos
    if (filter?.tag) result = result.filter(t => t.tags.includes(filter.tag!))
    if (filter?.status) result = result.filter(t => t.status === filter.status)
    return result
  }

  // 获取单个
  get(todoId: string): TodoItem {
    const todo = this.todos.find(t => t.id === todoId)
    if (!todo) throw new Error(`Todo not found: ${todoId}`)
    return todo
  }

  // 获取统计
  getStats() {
    const total = this.todos.length
    const done = this.todos.filter(t => t.status === 'done' || t.status === 'cancelled').length
    const inProgress = this.todos.filter(t => t.status === 'in_progress').length
    const pending = this.todos.filter(t => t.status === 'pending').length
    const blocked = this.todos.filter(t => t.status === 'blocked').length
    return {
      total, done, inProgress, pending, blocked,
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    }
  }

  // 按标签统计
  getStatsByTag() {
    const stats: Record<string, { total: number; done: number }> = {}
    for (const todo of this.todos) {
      for (const tag of todo.tags) {
        if (!stats[tag]) stats[tag] = { total: 0, done: 0 }
        stats[tag].total++
        if (todo.status === 'done' || todo.status === 'cancelled') stats[tag].done++
      }
    }
    return stats
  }

  // 生成上下文摘要
  getContextSummary(): string {
    const stats = this.getStats()
    const current = this.todos.find(t => t.status === 'in_progress')
    const nextPending = this.todos.find(t => t.status === 'pending')

    let summary = `## 当前待办清单\n\n`
    summary += `完成率: ${stats.completionRate}% (${stats.done}/${stats.total} 完成)`
    if (stats.inProgress > 0) summary += `, ${stats.inProgress} 进行中`
    if (stats.blocked > 0) summary += `, ${stats.blocked} 阻塞`
    summary += '\n\n'

    if (current) {
      summary += `**当前进行中:**\n- 🔵 ${current.text} [${current.priority}]\n\n`
    }

    if (nextPending) {
      summary += `**下一个待办:**\n- ⬜ ${nextPending.text} [${nextPending.priority}]\n\n`
    }

    summary += `**全部待办:**\n`
    for (const todo of this.todos) {
      const icon = todo.status === 'done' ? '✅' : todo.status === 'in_progress' ? '🔵' : todo.status === 'blocked' ? '🚫' : todo.status === 'cancelled' ? '⏭️' : '⬜'
      const priorityLabel = todo.priority === 'high' ? '🔴' : todo.priority === 'low' ? '🟢' : '🟡'
      const tags = todo.tags.length > 0 ? ` [${todo.tags.join(',')}]` : ''
      summary += `${icon} ${priorityLabel} ${todo.text}${tags}${todo.status === 'blocked' ? ' (阻塞: ' + todo.blockedReason + ')' : ''}\n`
    }

    return summary
  }
}

// ========== 模拟 Agent 执行循环 ==========
async function simulateAgentExecution() {
  const todoService = new TodoService()

  console.log('\n=== 1. 开始新步骤，创建 todo（todo_write 批量替换）===')
  todoService.replace([
    { text: '和用户确认功能列表', priority: 'high', tags: ['communication'], status: 'pending' },
    { text: '确认技术约束和边界条件', priority: 'high', tags: ['research'], status: 'pending' },
    { text: '输出需求文档', priority: 'normal', tags: ['doc'], status: 'pending' },
    { text: '画核心页面原型图', priority: 'normal', tags: ['design'], status: 'pending' },
    { text: '整理非功能性需求', priority: 'low', tags: ['doc'], status: 'pending' },
    { text: '和用户确认需求文档终稿', priority: 'high', tags: ['communication'], status: 'pending' },
  ])

  console.log('\n=== 2. 查看上下文摘要 ===')
  console.log(todoService.getContextSummary())

  console.log('\n=== 3. 执行第一个 todo：和用户确认功能列表 ===')
  const todos = todoService.list()
  todoService.markInProgress(todos[0].id)
  // 模拟执行...
  todoService.markDone(todos[0].id, '确认了用户注册、内容发布、评论互动三个核心功能')

  console.log('\n=== 4. 执行第二个 todo，同时发现需要添加新 todo ===')
  todoService.markInProgress(todos[1].id)
  todoService.markDone(todos[1].id, '确认了技术栈：Node.js + React + PostgreSQL')
  // 发现需要添加新 todo
  todoService.add('评估第三方服务和 API', 'normal', ['research'])
  console.log(`当前完成率: ${todoService.getStats().completionRate}%`)

  console.log('\n=== 5. 执行中遇到阻塞 ===')
  const designTodo = todoService.list({ tag: 'design' })[0]
  todoService.markInProgress(designTodo.id)
  todoService.markBlocked(designTodo.id, '等待用户提供品牌设计规范')

  console.log('\n=== 6. 查看上下文摘要（有阻塞）===')
  console.log(todoService.getContextSummary())

  console.log('\n=== 7. 按标签统计 ===')
  console.log(JSON.stringify(todoService.getStatsByTag(), null, 2))

  console.log('\n=== 8. 阻塞解除，继续执行 ===')
  todoService.update(designTodo.id, { status: 'pending', blockedReason: undefined })
  todoService.markInProgress(designTodo.id)
  todoService.markDone(designTodo.id, '完成了首页、内容详情页、个人中心页的原型')

  console.log('\n=== 9. 批量完成剩余 todo（模拟步骤快完成了）===')
  const remaining = todoService.list({ status: 'pending' })
  for (const todo of remaining) {
    todoService.markDone(todo.id, '批量完成')
  }
  console.log(`最终完成率: ${todoService.getStats().completionRate}%`)

  console.log('\n=== 10. 步骤完成，清空旧 todo，开始新步骤 ===')
  todoService.clear()
  // 新步骤：数据库设计
  todoService.replace([
    { text: '设计 users 表结构', priority: 'high', tags: ['backend'] },
    { text: '设计 posts 表结构', priority: 'high', tags: ['backend'] },
    { text: '设计 comments 表结构', priority: 'high', tags: ['backend'] },
    { text: '设计索引和关系', priority: 'normal', tags: ['backend'] },
    { text: '编写数据库迁移脚本', priority: 'normal', tags: ['backend'] },
  ])
  console.log('\n新步骤的 todo:')
  console.log(todoService.getContextSummary())
}

simulateAgentExecution().catch(console.error)
