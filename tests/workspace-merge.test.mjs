import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeWorkspaces, MergeConflict } from '../shared/workspace-merge.js'
import { initialNotebook, makeNote } from '../src/model.ts'
import { validNotebook } from '../shared/validation.js'

test('concurrent Agent heartbeats merge with user concept edits and revoke the old lease', () => {
  const base=initialNotebook(),task=makeNote('concept',10,10),board=base.boards[0]
  task.concept={...task.concept,status:'running',agentId:'agent',lease:{token:'token',revision:'a'.repeat(64),expiresAt:100}}
  board.notes.push(task);board.agents=[{id:'agent',name:'Agent',lastSeenAt:100}]
  const local=structuredClone(base),remote=structuredClone(base)
  const changed=local.boards[0].notes.at(-1),reported=remote.boards[0].notes.at(-1)
  changed.body='用户的新要求';changed.concept.status='pending';delete changed.concept.lease
  changed.concept.history=[{at:120,text:'用户修改要求。'}]
  reported.concept.progress='实际执行进展';reported.concept.lease.expiresAt=300
  remote.boards[0].agents[0].lastSeenAt=200
  const merged=mergeWorkspaces(base,local,remote),result=merged.boards[0].notes.at(-1)
  assert.equal(result.body,'用户的新要求');assert.equal(result.concept.lease,undefined)
  assert.equal(result.concept.status,'pending');assert.equal(result.concept.progress,'实际执行进展')
  assert.equal(merged.boards[0].agents[0].lastSeenAt,200);assert.ok(validNotebook(merged))
  assert.equal(task.concept.status,'running','the baseline remains immutable')
})

test('independent notes, cells and append-only history merge while concurrent edits and deletion conflicts are preserved', () => {
  const base=initialNotebook(),local=structuredClone(base),remote=structuredClone(base)
  local.boards[0].notes[0].title='本地标题'
  remote.boards[0].notes.push(makeNote('code',20,20))
  const merged=mergeWorkspaces(base,local,remote)
  assert.equal(merged.boards[0].notes[0].title,'本地标题');assert.equal(merged.boards[0].notes.at(-1).kind,'code')
  const conflicting=structuredClone(remote);conflicting.boards[0].notes[0].title='远程标题'
  assert.throws(()=>mergeWorkspaces(base,local,conflicting),MergeConflict)
  const deleted=structuredClone(base);deleted.boards[0].notes.shift()
  assert.throws(()=>mergeWorkspaces(base,local,deleted),MergeConflict)
  assert.deepEqual(mergeWorkspaces({history:[{at:1,text:'start'}]},{history:[{at:1,text:'start'},{at:3,text:'user'}]},{history:[{at:1,text:'start'},{at:2,text:'agent'}]}).history.map(e=>e.text),['start','agent','user'])
})
