// demo-27.ts（用七牛云沙箱执行代码）
import 'dotenv/config'
import { Sandbox } from '@e2b/code-interpreter'

async function main() {
  console.log('=== 创建沙箱 ===')
  const sbx = await Sandbox.create() // 默认 5 分钟存活
  console.log(`沙箱已创建: ${sbx.sandboxId}`)

  try {
    console.log('\n=== 执行代码 ===')
    const execution = await sbx.runCode(`
print("Hello from 七牛云沙箱!")
print(f"Python version: {__import__('sys').version.split()[0]}")
import os
print(f"Current dir: {os.getcwd()}")
print(f"Files in /: {os.listdir('/')[:10]}")
`)
    console.log('stdout:')
    execution.logs.stdout.forEach((line: string) => console.log(`  ${line}`))

    console.log('\n=== 测试读取系统文件（应该能读，但只在沙箱里）===')
    const execution2 = await sbx.runCode(`
with open('/etc/passwd') as f:
    lines = f.readlines()[:3]
    for line in lines:
        print(line.strip())
`)
    console.log('stdout:')
    execution2.logs.stdout.forEach((line: string) => console.log(`  ${line}`))

    console.log('\n=== 测试死循环（应该超时）===')
    try {
      await sbx.runCode('while True: pass', {
        timeoutMs: 5000, // 5 秒超时
      })
    } catch (e: any) {
      console.log('预期超时错误:', e.message.slice(0, 100))
    }
  } finally {
    console.log('\n=== 销毁沙箱 ===')
    await sbx.kill()
    console.log('沙箱已销毁')
  }
}

main().catch(console.error)
