import { watch } from "node:fs"

// 文件变更监听（票据 22）：Obsidian 手写改动、agent 落盘、Git 回流都会触发按 note_id 重索引。
// fs.watch 的触发粒度依平台而异（一次保存可能连发多起），这里只做防抖合并；
// 「文件在则重索引、没了则移除」的确定性逻辑在 indexer.syncNote 中，已由测试覆盖。

export type WatcherDeps = {
  vaultDir: string
  onNoteChange: (relPath: string) => Promise<void>
  debounceMs?: number
}

export function watchVault(deps: WatcherDeps): () => void {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    const batch = Array.from(pending)
    pending.clear()
    batch.forEach((relPath) => {
      deps.onNoteChange(relPath).catch((error) => console.error(`ybrain watch failed for ${relPath}: ${error}`))
    })
  }

  const watcher = watch(deps.vaultDir, { recursive: true }, (_event, filename) => {
    if (typeof filename !== "string" || !filename.endsWith(".md")) return
    pending.add(filename)
    clearTimeout(timer)
    timer = setTimeout(flush, deps.debounceMs ?? 500)
  })

  return () => {
    watcher.close()
    clearTimeout(timer)
  }
}
