import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpLab } from '../mcp/workbench.mjs'
import { hash } from '../mcp/project-policy.mjs'

test('MCP never reports code output as saved when the atomic workspace write fails',async t=>{
  const note={id:'code',kind:'code',cells:[{id:'cell',language:'javascript',code:'console.log(8)',stdin:''}]}
  let notebook={boards:[{id:'board',notes:[note]}]},failWrites=false
  let job={id:'job',status:'running',stdout:'',stderr:''}
  const lab=createMcpLab({
    jobs:{start:()=>job,get:()=>job,cancel:()=>{}},debugging:{command:async()=>{}},
    readWorkspace:async()=>({notebook:structuredClone(notebook)}),
    mutateWorkspace:async mutator=>{const change=await mutator(structuredClone(notebook));if(!change.unchanged){if(failWrites)throw new Error('模拟磁盘写入失败');notebook=change.notebook}return change.result},
  })
  t.after(()=>lab.close())
  await lab.start({boardId:'board',requestId:'once',noteId:'code',cellId:'cell',expectedHash:hash(note)},'code')
  failWrites=true;job={...job,status:'success',stdout:'8\n',exitCode:0}
  const result=await lab.get(job.id)
  assert.equal(result.savedToNote,false);assert.match(result.resultNotice,/写入失败/)
  assert.equal(result.stdout,'8\n');assert.equal(notebook.boards[0].notes[0].cells[0].output,undefined)
})
