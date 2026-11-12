import test from 'node:test'
import assert from 'node:assert/strict'
import {
  arrangeNotes,
  initialNotebook,
  makeBoard,
  makeNote,
  upgradeWorkspace,
  workDate,
} from '../src/model.ts'

test('upgrading a saved notebook preserves every existing board and attachment', () => {
  const board = makeBoard('现有工作内容')
  const note = {
    ...makeNote('file', -200, 340),
    assetId: 'existing-local-attachment',
    filename: '合同资料.pdf',
  }
  board.notes.push(note)
  const legacy = { version: 1, activeBoardId: board.id, boards: [board] }
  const before = structuredClone(legacy)
  const upgraded = upgradeWorkspace(legacy)
  assert.deepEqual(legacy, before)
  assert.strictEqual(
    upgraded.boards.find((value) => value.id === board.id),
    board,
  )
  assert.deepEqual(
    upgraded.boards.find((value) => value.id === board.id).notes[0],
    note,
  )
  assert.equal(upgraded.workspaceVersion, 1)
  assert.strictEqual(upgradeWorkspace(upgraded), upgraded)
  assert.equal(
    upgraded.boards.filter((value) => value.id === 'work-launch').length,
    1,
  )
})

test('auto arrange keeps content, attachment references and dimensions, with no overlaps', () => {
  const notes = Array.from({ length: 9 }, (_, index) => ({
    ...makeNote(index % 2 ? 'text' : 'file', index * -29, index * 5),
    width: 240 + index * 17,
    height: 130 + index * 23,
    assetId: `asset-${index}`,
  }))
  const before = structuredClone(notes)
  const arranged = arrangeNotes(notes)
  assert.deepEqual(notes, before)
  for (const [index, note] of arranged.entries()) {
    const { x, y, ...content } = note
    const { x: oldX, y: oldY, ...original } = notes[index]
    assert.deepEqual(content, original)
    assert.ok(x >= 0 && y >= 0)
    for (const other of arranged.slice(index + 1))
      assert.ok(
        note.x + note.width <= other.x ||
          other.x + other.width <= note.x ||
          note.y + note.height <= other.y ||
          other.y + other.height <= note.y,
      )
  }
})

test('project and meeting templates create independent tasks and valid connections', () => {
  const first = makeBoard('项目甲', 'project'),
    second = makeBoard('项目乙', 'project')
  const task = first.notes.find((note) => note.items)?.items[0]
  task.done = !task.done
  assert.notDeepEqual(first.notes, second.notes)
  assert.notEqual(first.id, second.id)
  const meeting = makeBoard('会议', 'meeting')
  assert.ok(
    meeting.notes.some(
      (note) => note.kind === 'checklist' && note.items.length > 0,
    ),
  )
  for (const board of initialNotebook().boards)
    for (const connection of board.connections) {
      assert.ok(board.notes.some((note) => note.id === connection.from))
      assert.ok(board.notes.some((note) => note.id === connection.to))
    }
  assert.match(workDate(), /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(workDate(1) > workDate())
})
