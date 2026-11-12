import test from 'node:test'
import assert from 'node:assert/strict'
import { makeBoard, makeNote, uid } from '../src/model.ts'
import { boardSubtree, boardTrail, canvasHierarchyError, copyBoardTree, orderedBoards } from '../shared/canvas-tree.js'
import { validNotebook } from '../shared/validation.js'
import { assetIdsForNote } from '../shared/attachments.js'
import { createPresentationSession, movePresentationNote, presentationFit } from '../src/presentation-state.ts'

function fixture() {
  const root = makeBoard('汇报', 'blank'), child = { ...makeBoard('项目详情', 'blank'), parentBoardId: root.id }
  const nested = { ...makeBoard('原始依据', 'blank'), parentBoardId: child.id }
  root.notes.push({ ...makeNote('board', 20, 30), childBoardId: child.id })
  child.notes.push({ ...makeNote('board', -40, 80), childBoardId: nested.id }, { ...makeNote('file', 500, 10), assetId: 'shared-file', filename: 'data.bin' })
  nested.notes.push({ ...makeNote('file', 10, 10), assetId: 'shared-file', filename: 'same-data.bin' })
  return { version: 1, boards: [root, child, nested], activeBoardId: root.id }
}

test('nested canvases share attachment IDs, retain hierarchy after backup copies and never inline child data', () => {
  const notebook = fixture(), [root, child, nested] = notebook.boards
  assert.ok(validNotebook(notebook))
  assert.deepEqual(boardTrail(notebook.boards, nested.id).map(board => board.title), ['汇报', '项目详情', '原始依据'])
  assert.deepEqual(boardSubtree(notebook.boards, child.id).map(board => board.id), [child.id, nested.id])
  assert.deepEqual(orderedBoards([nested, child, root]).map(board => board.id), [root.id, child.id, nested.id])
  const copy = copyBoardTree(JSON.parse(JSON.stringify(notebook)).boards, uid)
  assert.ok(validNotebook({ ...notebook, boards: copy, activeBoardId: copy[0].id }))
  assert.equal(copy[0].notes[0].childBoardId, copy[1].id)
  assert.equal(copy[2].parentBoardId, copy[1].id)
  assert.ok(copy.every(board => !notebook.boards.some(original => original.id === board.id)))
  assert.deepEqual([...new Set(copy.flatMap(board => board.notes.flatMap(assetIdsForNote)))], ['shared-file'])
  assert.equal(copy[0].notes[0].boards, undefined)
  // Removing an entrance retains its contents and navigable parent relationship.
  root.notes = []
  assert.ok(validNotebook(notebook))
  assert.equal(boardSubtree(notebook.boards, root.id).length, 3)
})

test('hierarchy rejects dangling references, self containment, cycles and cross-parent portals without throwing on malformed data', () => {
  const notebook = fixture()
  assert.equal(validNotebook({ ...notebook, agentProjects: [{ ...makeBoard('坏数据', 'blank'), notes: {} }] }), false)
  for (const mutate of [
    value => { value.boards[1].parentBoardId = 'missing' },
    value => { value.boards[1].parentBoardId = value.boards[1].id },
    value => { value.boards[0].parentBoardId = value.boards[2].id },
    value => { value.boards[0].notes[0].childBoardId = value.boards[2].id },
    value => { value.boards[0].notes[0].childBoardId = 'missing' },
    value => { value.boards[0].notes = {} },
    value => { value.boards[0].notes = [null] },
  ]) {
    const invalid = structuredClone(notebook); mutate(invalid)
    assert.equal(validNotebook(invalid), false)
    assert.ok(canvasHierarchyError(invalid.boards))
  }
  const restored = copyBoardTree(notebook.boards.slice(1), uid)
  assert.equal(restored[0].parentBoardId, undefined)
  assert.equal(canvasHierarchyError(restored), '')
  const withoutDeletedChild = copyBoardTree([notebook.boards[0]], uid)
  assert.equal(withoutDeletedChild[0].notes.length, 0)
})

test('presentation snapshots isolate all nested layouts, content and assets from the saved notebook', () => {
  const notebook = fixture(), before = JSON.stringify(notebook), [root, child] = notebook.boards
  const initial = createPresentationSession(notebook, root.id)
  const changed = movePresentationNote(initial, root.id, root.notes[0].id, -325, 144)
  const nested = movePresentationNote({ ...changed, boardId: child.id }, child.id, child.notes[0].id, 200, 500)
  assert.equal(nested.boards[0].notes[0].x, -325)
  assert.equal(nested.boards[1].notes[0].y, 500)
  assert.equal(initial.boards[0].notes[0].x, 20)
  assert.equal(initial.boards[1].notes[0].y, 80)
  assert.equal(JSON.stringify(notebook), before)
  // External Agent updates during a presentation cannot mutate its snapshot.
  notebook.boards[1].notes[1].title = 'Agent 的最新修改'
  assert.notEqual(nested.boards[1].notes[1].title, 'Agent 的最新修改')
  assert.equal(nested.boards[1].notes[1].assetId, 'shared-file')
  assert.equal(movePresentationNote(nested, root.id, root.notes[0].id, NaN, 5), nested)
  const restarted = createPresentationSession(notebook, root.id)
  assert.equal(restarted.boards[0].notes[0].x, 20)
  const view = presentationFit(nested.boards[1], 1920, 1080)
  for (const note of nested.boards[1].notes) {
    assert.ok(view.x + note.x * view.zoom >= 0)
    assert.ok(view.y + note.y * view.zoom >= 0)
    assert.ok(view.x + (note.x + note.width) * view.zoom <= 1920)
    assert.ok(view.y + (note.y + note.height) * view.zoom <= 1080)
  }
})
