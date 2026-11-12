import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { initialNotebook, makeNote } from '../src/model.ts'
import { migrateAgentProjects } from '../shared/agent-workspace.js'
import { validNotebook } from '../shared/validation.js'
import { mergeWorkspaces } from '../shared/workspace-merge.js'
import { createFieldnotesServer } from '../server.mjs'

function legacyNotebook(){
  const notebook=initialNotebook(),board=notebook.boards[0],first=makeNote('concept',0,0),second=makeNote('concept',500,0)
  second.concept.dependsOn=[first.id]
  const overview={...makeNote('markdown',0,500),source:{requestId:'plan',section:'agent-plan',createdAt:new Date().toISOString()}}
  board.notes.push(first,second,overview)
  board.agents=[{id:'agent',name:'真实 Agent',lastSeenAt:Date.now()}]
  board.connections.push({id:'dependency',from:first.id,to:second.id},{id:'mixed',from:board.notes[0].id,to:first.id})
  return {notebook,board,first,second,overview}
}

test('legacy plans migrate outside canvases while preserving note IDs, dependencies, activity and unrelated notes',()=>{
  const {notebook,board,first,second,overview}=legacyNotebook(),before=structuredClone(notebook)
  const result=migrateAgentProjects(notebook),project=result.agentProjects[0]
  assert.deepEqual(notebook,before,'migration must not mutate input')
  assert.equal(project.legacyBoardId,board.id);assert.equal(result.activeAgentProjectId,project.id)
  assert.deepEqual(project.notes,[first,second,overview]);assert.deepEqual(project.agents,board.agents)
  assert.deepEqual(project.connections,[board.connections.find(e=>e.id==='dependency')])
  assert.deepEqual(result.boards[0].notes,board.notes.filter(n=>![first.id,second.id,overview.id].includes(n.id)))
  assert.ok(result.boards[0].connections.every(e=>e.from!==first.id&&e.to!==first.id))
  assert.deepEqual(project.notes[1].concept.dependsOn,[first.id]);assert.ok(validNotebook(result))
  assert.strictEqual(migrateAgentProjects(result),result,'migration is idempotent')
})

test('migration avoids existing IDs, keeps trashed projects hidden, and merges newly created independent projects',()=>{
  const {notebook,board}=legacyNotebook()
  board.trashed=true
  notebook.agentProjects=[{...structuredClone(board),id:'agent-'+board.id,notes:[],connections:[]}]
  const result=migrateAgentProjects(notebook)
  assert.equal(result.agentProjects.length,2);assert.notEqual(result.agentProjects[0].id,result.agentProjects[1].id)
  assert.equal(result.agentProjects[1].trashed,true);assert.ok(validNotebook(result))
  const base=initialNotebook(),left=structuredClone(base),right=structuredClone(base)
  left.agentProjects=[{...result.agentProjects[0],id:'agent-left'}]
  right.agentProjects=[{...result.agentProjects[0],id:'agent-right'}]
  const merged=mergeWorkspaces(base,left,right)
  assert.deepEqual(merged.agentProjects.map(p=>p.id),['agent-left','agent-right']);assert.ok(validNotebook(merged))
})

test('server migrates a saved legacy workspace and accepts its original ETag for persistence',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'own-migration-test-'))
  const {notebook}=legacyNotebook();await writeFile(path.join(directory,'notebook.json'),JSON.stringify(notebook))
  const server=await createFieldnotesServer({dataDir:directory});server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(directory),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('own-migration-test-'));await rm(directory,{recursive:true,force:true})})
  const url=`http://127.0.0.1:${server.address().port}/api/notebook`,response=await fetch(url),{notebook:upgraded}=await response.json()
  assert.equal(upgraded.agentProjects[0].notes.length,3);assert.ok(validNotebook(upgraded))
  const saved=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':response.headers.get('etag')},body:JSON.stringify(upgraded)})
  assert.equal(saved.status,200,await saved.text())
  const reopened=(await (await fetch(url)).json()).notebook
  assert.deepEqual(reopened.agentProjects,upgraded.agentProjects)
})
