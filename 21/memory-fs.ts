// memory-fs.ts（简化版内存 fs 插件：只实现 read 和 list，加日志）
import { FileSystem, FsError } from '@deepseek-ai/dsh-fs'

const name = 'memory-fs'
const inject = []

class MemoryFileSystem extends FileSystem {
  private files = new Map<string, { content: string; isDirectory: boolean }>()

  get sandboxMode() {
    return 'danger-full-access'
  }

  // 路径规范化
  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '')
  }

  // resolve：把路径解析成 targetKey
  async resolve(path: string, opts?: any) {
    if (path.trim().length === 0) {
      throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
    }
    const displayPath = this.normalizePath(path)
    const targetKey = displayPath // 简化：直接用路径作为 targetKey
    console.log(`[MemoryFs] resolve: ${displayPath}`)
    return { targetKey, displayPath }
  }

  processPath(target: any) {
    return String(target.targetKey)
  }

  // stat：返回文件元数据
  async stat(target: any, signal?: any) {
    const path = this.normalizePath(target.targetKey)
    const entry = this.files.get(path)
    if (!entry) return undefined

    console.log(`[MemoryFs] stat: ${path} (${entry.isDirectory ? 'dir' : 'file'}, ${entry.content.length} bytes)`)

    return {
      version: `v-${entry.content.length}`,
      type: entry.isDirectory ? 'directory' : 'file',
      size: entry.content.length,
    }
  }

  // readText：读文件内容（核心方法）
  async readText(target: any, signal?: any) {
    const path = this.normalizePath(target.targetKey)
    const entry = this.files.get(path)

    if (!entry) {
      throw new FsError(`File not found: ${path}`, 'FS_NOT_FOUND')
    }
    if (entry.isDirectory) {
      throw new FsError(`Cannot read directory: ${path}`, 'FS_NOT_FILE')
    }

    console.log(`[MemoryFs] read: ${path} (${entry.content.length} bytes)`)
    return entry.content
  }

  // listDir：列目录（核心方法）
  async listDir(target: any, signal?: any) {
    const dir = this.normalizePath(target.targetKey)
    const prefix = dir.endsWith('/') ? dir : dir + '/'

    const children = new Map<string, { name: string; type: string; size: number }>()

    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length)
        const slashIdx = rest.indexOf('/')
        if (slashIdx === -1) {
          // 直接子文件
          const entry = this.files.get(path)!
          children.set(rest, {
            name: rest,
            type: entry.isDirectory ? 'directory' : 'file',
            size: entry.content.length,
          })
        } else {
          // 子目录
          const dirName = rest.slice(0, slashIdx)
          if (!children.has(dirName)) {
            children.set(dirName, {
              name: dirName,
              type: 'directory',
              size: 0,
            })
          }
        }
      }
    }

    console.log(`[MemoryFs] list: ${dir} (${children.size} items)`)

    return [...children.values()].map((entry) => ({
      name: entry.name,
      type: entry.type,
      target: {
        targetKey: `${prefix}${entry.name}`,
        displayPath: `${prefix}${entry.name}`,
      },
      size: entry.size,
    }))
  }

  // 其他方法：抛 not implemented（这个演示只支持读和列目录）
  async writeText(): Promise<never> {
    throw new FsError('memory-fs: writeText not implemented in this demo', 'FS_NOT_IMPLEMENTED')
  }

  async editText(): Promise<never> {
    throw new FsError('memory-fs: editText not implemented in this demo', 'FS_NOT_IMPLEMENTED')
  }

  async lstat(): Promise<never> {
    throw new FsError('memory-fs: lstat not implemented in this demo', 'FS_NOT_IMPLEMENTED')
  }

  async readBytes(): Promise<never> {
    throw new FsError('memory-fs: readBytes not implemented in this demo', 'FS_NOT_IMPLEMENTED')
  }

  async streamText(): Promise<never> {
    throw new FsError('memory-fs: streamText not implemented in this demo', 'FS_NOT_IMPLEMENTED')
  }
}

function apply(ctx: any, config: any = {}) {
  // 预填充一些测试文件
  const fs = new MemoryFileSystem(ctx)
  fs.files.set('/workspace', { content: '', isDirectory: true })
  fs.files.set('/workspace/hello.txt', { content: 'Hello World from MemoryFs!', isDirectory: false })
  fs.files.set('/workspace/notes.md', { content: '# Notes\n- This is a memory filesystem demo', isDirectory: false })
  console.log('[MemoryFs] 插件已加载，预填充了 2 个测试文件')
}

export { name, inject, apply, MemoryFileSystem }
