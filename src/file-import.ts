export interface ImportEntry { path: string; file?: File }
export interface ImportGroup { name: string; folder: boolean; entries: ImportEntry[] }

export function groupPickedFiles(files: FileList | File[]): ImportGroup[] {
  const groups = new Map<string, ImportGroup>()
  const result: ImportGroup[] = []
  for (const file of Array.from(files)) {
    const relative = file.webkitRelativePath
    if (!relative) { result.push({ name: file.name, folder: false, entries: [{ path: file.name, file }] }); continue }
    const [root, ...parts] = relative.split('/')
    let group = groups.get(root)
    if (!group) { group = { name: root, folder: true, entries: [] }; groups.set(root, group); result.push(group) }
    const path = parts.join('/')
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/')
      if (!group.entries.some((entry) => entry.path === parent)) group.entries.push({ path: parent })
    }
    group.entries.push({ path, file })
  }
  return result
}

// Capture entries synchronously while the drop's data store is still readable.
// Directory readers return batches, not the complete child list in one call.
export function collectDrop(data: DataTransfer): Promise<ImportGroup[]> {
  const entries = Array.from(data.items).filter((item) => item.kind === 'file').map((item) => ({
    entry: item.webkitGetAsEntry?.(), file: item.getAsFile(),
  }))
  if (!entries.length) return Promise.resolve(groupPickedFiles(Array.from(data.files)))
  return Promise.all(entries.map(async ({ entry, file }) => {
    if (!entry) return file ? { name: file.name, folder: false, entries: [{ path: file.name, file }] } : null
    const group: ImportGroup = { name: entry.name, folder: entry.isDirectory, entries: [] }
    const visit = async (current: FileSystemEntry, path: string, depth = 0): Promise<void> => {
      if (depth > 64 || group.entries.length >= 10000) throw new Error(`${group.name} 的目录过深或超过 10000 个条目，请分批导入。`)
      if (current.isFile) {
        const file = await new Promise<File>((resolve, reject) => (current as FileSystemFileEntry).file(resolve, reject))
        group.entries.push({ path, file })
      } else {
        if (path) group.entries.push({ path })
        const reader = (current as FileSystemDirectoryEntry).createReader()
        while (true) {
          const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
          if (!batch.length) break
          for (const child of batch) await visit(child, path ? `${path}/${child.name}` : child.name, depth + 1)
        }
      }
    }
    await visit(entry, entry.isDirectory ? '' : entry.name)
    return group
  })).then((groups) => groups.filter((group): group is ImportGroup => !!group))
}
