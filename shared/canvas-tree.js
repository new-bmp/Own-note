// Canvases share one notebook and the same asset IDs; portals only store a reference.
export function canvasHierarchyError(boards) {
  if (!Array.isArray(boards) || boards.some(board => !board || !Array.isArray(board.notes))) return '画布内容无效。'
  const byId = new Map(boards.map(board => [board?.id, board]))
  for (const board of boards) {
    if (board?.parentBoardId !== undefined && (typeof board.parentBoardId !== 'string' || !byId.has(board.parentBoardId))) return '子画布的上级不存在。'
    const visited = new Set([board?.id])
    let current = board
    while (current?.parentBoardId !== undefined) {
      if (visited.has(current.parentBoardId)) return '画布层级不能形成循环。'
      visited.add(current.parentBoardId)
      current = byId.get(current.parentBoardId)
    }
    for (const note of board?.notes || []) {
      if (!note || typeof note !== 'object') return '画布内容无效。'
      if (note.kind === 'board') {
        const child = byId.get(note.childBoardId)
        if (!child || child.parentBoardId !== board.id) return '子画布入口必须指向当前画布的下级。'
      } else if (note.childBoardId !== undefined) return '只有子画布入口可以引用下级画布。'
    }
  }
  return ''
}

export function boardTrail(boards, id) {
  const byId = new Map(boards.map(board => [board.id, board]))
  const trail = [], seen = new Set()
  let board = byId.get(id)
  while (board && !seen.has(board.id)) {
    seen.add(board.id)
    trail.unshift(board)
    board = byId.get(board.parentBoardId)
  }
  return trail
}

export function boardSubtree(boards, id) {
  const ids = new Set([id])
  // Iterative traversal handles deep hierarchies without recursive stack growth.
  const children = new Map()
  for (const board of boards) {
    if (!children.has(board.parentBoardId)) children.set(board.parentBoardId, [])
    children.get(board.parentBoardId).push(board)
  }
  const queue = [id]
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) || []) {
    if (!ids.has(child.id)) { ids.add(child.id); queue.push(child.id) }
  }
  return boards.filter(board => ids.has(board.id))
}

export function orderedBoards(boards) {
  const ids = new Set(boards.map(board => board.id))
  const result = [], seen = new Set(), children = new Map()
  for (const board of boards) {
    if (!children.has(board.parentBoardId)) children.set(board.parentBoardId, [])
    children.get(board.parentBoardId).push(board)
  }
  const roots = boards.filter(board => !ids.has(board.parentBoardId))
  for (const root of [...roots, ...boards]) {
    const stack = [root]
    while (stack.length) {
      const board = stack.pop()
      if (seen.has(board.id)) continue
      seen.add(board.id); result.push(board)
      stack.push(...(children.get(board.id) || []).toReversed())
    }
  }
  return result
}

// Import/recovery allocates new board IDs but never duplicates stored asset data.
export function copyBoardTree(boards, nextId) {
  const ids = new Map(boards.map(board => [board.id, nextId()]))
  return boards.map(board => ({
    ...structuredClone(board), id: ids.get(board.id),
    creationRequest: undefined,
    parentBoardId: ids.get(board.parentBoardId),
    notes: board.notes.filter(note => note.kind !== 'board' || ids.has(note.childBoardId)).map(note => ({
      ...structuredClone(note), ...(note.kind === 'board' ? { childBoardId: ids.get(note.childBoardId) } : {}),
    })),
  }))
}
