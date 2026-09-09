// demo-04.ts
import { Context, Service } from '@deepseek-ai/cordis'

/** 计数器（普通对象形式） */
interface Counter {
  value: number
  inc(): void
}

/** 问候服务（Service 类形式，可调用） */
class GreeterService extends Service {
  greeting = 'Hello (initialized)'

  constructor(ctx: Context) {
    super(ctx, 'greeter') // 注册为 ctx.greeter
  }

  // 实例化后由框架自动调用（类插件生命周期）
  [Service.init]() {
    console.log('  [GreeterService] init 被调用，服务已就绪')
  }

  setGreeting(greeting: string) {
    this.greeting = greeting
  }

  // 使 ctx.greeter(...) 本身可调用
  [Service.invoke](name: string) {
    return `${this.greeting}, ${name}!`
  }
}

// 让 app.greeter / app.counter 拥有类型
declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService & ((name: string) => string)
    counter: Counter
  }
}

const app = new Context()

// 使用方：依赖 greeter，激活后调用服务
const consumer = {
  name: 'greeter-consumer',
  inject: ['greeter'],
  apply(ctx: Context) {
    console.log('  调用 ctx.greeter("World") →', ctx.greeter('World'))
    ctx.greeter.setGreeting('Hi')
    console.log('  改问候语后 →', ctx.greeter('World'))
  },
}

// 普通对象也能作为服务值注册
const counter: Counter = {
  value: 0,
  inc() {
    this.value++
  },
}

async function main() {
  console.log('=== 步骤1：注册 GreeterService（init 应自动调用）===')
  await app.plugin(GreeterService)

  console.log('\n=== 步骤2：注册使用方（应自动激活）===')
  await app.plugin(consumer)

  console.log('\n=== 步骤3：验证服务在上下文上可读 ===')
  console.log('  app.greeter 存在吗？', Boolean(app.greeter))

  console.log('\n=== 步骤4：验证普通对象也能作为 Service 注册 ===')
  app.provide('counter', counter)
  console.log('  app.counter.value =', app.counter.value)
  counter.inc()
  console.log('  inc 后 =', app.counter.value)
}

main()
