// demo-08.ts
import { Context } from '@deepseek-ai/cordis'

// 把本文件用到的自定义事件注册进 Events，让 on/serial/parallel/bail/waterfall/emit 获得类型
declare module '@deepseek-ai/cordis' {
  interface Events {
    'ask'(payload?: unknown): unknown
    'sync-ask'(payload?: unknown): unknown
    'transform'(data: any, next: any): unknown
  }
}

const log: string[] = []
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const app = new Context()

// 三个监听器，模拟"谁能拍板"
app.on('ask', async () => {
  log.push('A 开始')
  await sleep(30)
  log.push('A 结束')
  return null  // 不拍板
})
app.on('ask', async () => {
  log.push('B 开始')
  await sleep(10)
  log.push('B 结束')
  return 'B 拍板'  // 拍板
})
app.on('ask', async () => {
  log.push('C 开始')
  await sleep(10)
  log.push('C 结束')
  return 'C 拍板'
})

console.log('=== serial：异步串行，B 拍板后 C 不执行 ===')
log.length = 0
await app.serial('ask', {})
console.log(log.join('\n'))

console.log('\n=== parallel：并发执行，三个都跑完 ===')
log.length = 0
await app.parallel('ask', {})
console.log(log.join('\n'))

console.log('\n=== bail：同步串行，禁止 async（演示 async 的坑）===')
log.length = 0
app.on('sync-ask', () => { log.push('A'); return null })
app.on('sync-ask', () => { log.push('B'); return 'B 拍板' })
app.on('sync-ask', () => { log.push('C'); return 'C 拍板' })
const bailResult = app.bail('sync-ask', {})
console.log(log.join('\n'))
console.log('结果:', bailResult)

console.log('\n=== waterfall：瀑布中间件，逐层改数据 ===')
log.length = 0
app.on('transform', (data: any, next: any) => {
  log.push('第一层：加 1')
  data.value += 1
  const result = next()
  log.push('第一层：包装结果')
  return result * 2
})
app.on('transform', (data: any, next: any) => {
  log.push('第二层：加 10')
  data.value += 10
  return next()
})
const wfResult = app.waterfall('transform', { value: 0 }, (data: any) => {
  log.push('最内层：返回原始值')
  return data.value
})
console.log(log.join('\n'))
console.log('最终结果:', wfResult)

// 第 5 类派发：emit —— 广播触发，同步调用所有监听器，
// 不 await 返回的 Promise，也不收集/利用返回值（fire-and-forget）
console.log('\n=== emit：广播触发，fire-and-forget（不等待、不取结果）===')
log.length = 0
app.emit('ask', {})   // 立即返回 void，此时每个异步监听器只跑到第一个 await
console.log('emit 刚返回的同步时刻：')
console.log(log.join('\n'))
await sleep(50)       // 给后台监听器留出跑完的时间（B/C=10ms，A=30ms）
console.log('等待 50ms 后（后台监听器全部完成）：')
console.log(log.join('\n'))