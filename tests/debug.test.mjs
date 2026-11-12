import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createDebugSessions } from '../services/debug.mjs'
import { toolchainPaths, executionEnv } from '../services/toolchains.mjs'
import { parseMi } from '../services/gdb-mi.mjs'
import { tmpdir } from 'node:os'

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function settled(debug,id,predicate=value=>!['starting','running'].includes(value.status)){
  const deadline=Date.now()+20000
  while(Date.now()<deadline){const value=debug.get(id);if(predicate(value))return value;await delay(20)}
  assert.fail(`Debugger timed out: ${JSON.stringify(debug.get(id))}`)
}
async function advance(debug,id,line){
  let value=await settled(debug,id)
  for(let i=0;i<15&&value.status==='paused'&&value.line!==line;i++){
    await debug.command(id,{action:'next'});value=await settled(debug,id)
  }
  assert.equal(value.status,'paused',JSON.stringify(value));assert.equal(value.line,line)
  return value
}

test('Node inspector steps actual JavaScript variables, watches and breakpoints and preserves output',async t=>{
  const debug=createDebugSessions();t.after(()=>debug.close())
  const {id}=debug.start({language:'javascript',stdin:'',code:'let total = 3;\ntotal += 5;\nconsole.log(total);\ntotal += 2;\nconsole.log(total);'})
  let value=await advance(debug,id,2)
  assert.equal(value.variables.find(v=>v.name==='total').value,'3')
  await debug.command(id,{action:'configure',breakpoints:[4],watches:['total * 2']})
  value=debug.get(id);assert.equal(value.watches[0].value,'6')
  await debug.command(id,{action:'continue'});value=await settled(debug,id)
  assert.equal(value.line,4);assert.equal(value.variables.find(v=>v.name==='total').value,'8');assert.equal(value.stdout,'8\n')
  await debug.command(id,{action:'next'});value=await settled(debug,id)
  assert.equal(value.variables.find(v=>v.name==='total').value,'10');assert.equal(value.watches[0].value,'20')
  await debug.command(id,{action:'continue'});value=await settled(debug,id)
  assert.equal(value.status,'finished',value.stderr);assert.equal(value.stdout,'8\n10\n');assert.equal(value.exitCode,0)
})

test('TypeScript enters and leaves real function frames and supports frame selection',async t=>{
  const debug=createDebugSessions();t.after(()=>debug.close())
  const {id}=debug.start({language:'typescript',stdin:'',code:'function twice(n: number): number {\n  const result: number = n * 2;\n  return result;\n}\nconst total: number = twice(6);\nconsole.log(total);',breakpoints:[2]})
  await settled(debug,id);await debug.command(id,{action:'continue'})
  let value=await settled(debug,id);assert.equal(value.line,2);assert.equal(value.frames[0].name,'twice')
  assert.equal(value.variables.find(v=>v.name==='n').value,'6');assert.ok(value.frames.length>=2)
  await debug.command(id,{action:'frame',index:1});assert.equal(debug.get(id).line,5)
  await debug.command(id,{action:'frame',index:0});await debug.command(id,{action:'out'})
  value=await settled(debug,id);assert.ok([5,6].includes(value.line));assert.equal(value.frames.length,1)
  await debug.command(id,{action:'continue'});value=await settled(debug,id)
  assert.equal(value.status,'finished');assert.equal(value.stdout,'12\n')
})

test('debugger stops active processes, bounds capacity and rejects invalid operations',async t=>{
  const debug=createDebugSessions();t.after(()=>debug.close())
  const first=debug.start({language:'javascript',stdin:'',code:'setInterval(()=>{}, 100);'})
  const second=debug.start({language:'javascript',stdin:'',code:'console.log("second");'})
  assert.throws(()=>debug.start({language:'python',stdin:'',code:'pass'}),/最多/)
  assert.equal((await debug.command(second.id,{action:'stop'})).status,'stopped')
  await settled(debug,first.id);await assert.rejects(debug.command(first.id,{action:'frame',index:99}),/无效/)
  await debug.command(first.id,{action:'continue'});await delay(100)
  assert.equal((await debug.command(first.id,{action:'stop'})).status,'stopped')
  assert.throws(()=>debug.start({language:'shell',code:'echo x',stdin:''}),/调试支持/)
  assert.throws(()=>debug.start({language:'javascript',code:'1',stdin:'',breakpoints:[-1]}),/断点/)
  assert.throws(()=>debug.get('missing'),/已过期/)
})

const paths=toolchainPaths()
const available=(command,args)=>spawnSync(command,args,{windowsHide:true,env:executionEnv(tmpdir()),timeout:5000}).status===0
test('Python debugger separates stdin, steps locals and watches, and stops at configured breakpoints',{skip:!available(paths.python,['--version'])},async t=>{
  const debug=createDebugSessions();t.after(()=>debug.close())
  const {id}=debug.start({language:'python',stdin:'3 5\n',code:'values = list(map(int, input().split()))\ntotal = sum(values)\nprint(total)\ntotal += 2\nprint(total)'})
  let value=await advance(debug,id,3)
  assert.equal(value.variables.find(v=>v.name==='values').value,'[3, 5]');assert.equal(value.variables.find(v=>v.name==='total').value,'8')
  await debug.command(id,{action:'configure',breakpoints:[4],watches:['total * 2','print("must not run")']})
  value=await settled(debug,id,v=>v.watches.length===2)
  assert.equal(value.watches[0].value,'16');assert.equal(value.watches[1].error,true)
  await debug.command(id,{action:'continue'});value=await settled(debug,id)
  assert.equal(value.line,4);assert.equal(value.stdout.trim(),'8')
  await debug.command(id,{action:'continue'});value=await settled(debug,id)
  assert.equal(value.status,'finished',value.stderr);assert.equal(value.stdout.replaceAll('\r\n','\n'),'8\n10\n')
})

test('Python debugging preserves explicit process exit codes without wrapper tracebacks',{skip:!available(paths.python,['--version'])},async t=>{
  const debug=createDebugSessions();t.after(()=>debug.close())
  for(const exitCode of [0,7]){
    const {id}=debug.start({language:'python',stdin:'',code:`import sys\nprint("before exit")\nsys.exit(${exitCode})`})
    await settled(debug,id);await debug.command(id,{action:'continue'})
    const value=await settled(debug,id)
    assert.equal(value.exitCode,exitCode);assert.equal(value.status,exitCode?'error':'finished')
    assert.equal(value.stderr,'');assert.equal(value.stdout.trim(),'before exit')
  }
})

test('GDB can pause a continuously running C++ program and read its live locals',{skip:!available(paths.cpp,['--version'])||!available(paths.gdb,['--version'])},async t=>{
  const debug=createDebugSessions();t.after(()=>debug.close())
  const {id}=debug.start({language:'cpp',stdin:'',code:'int main() {\n volatile unsigned total = 0;\n while (true) { total++; }\n}'})
  await settled(debug,id);await debug.command(id,{action:'continue'});await delay(100)
  assert.equal(debug.get(id).status,'running')
  await debug.command(id,{action:'pause'});const value=await settled(debug,id)
  assert.equal(value.status,'paused',JSON.stringify(value));assert.equal(value.line,3)
  assert.ok(Number(value.variables.find(v=>v.name==='total')?.value)>0)
  assert.equal((await debug.command(id,{action:'stop'})).status,'stopped')
})

test('GDB/MI parses nested frames, values, token replies and escaped output without evaluation',()=>{
  assert.deepEqual(parseMi('12^done,variables=[{name="a",value="3"},{name="text",value="\\\"Own\\\""}]'),{token:12,kind:'^',name:'done',data:{variables:[{name:'a',value:'3'},{name:'text',value:'"Own"'}]}})
  assert.equal(parseMi('*stopped,reason="breakpoint-hit",frame={func="main",line="4"}').data.frame.line,'4')
  assert.deepEqual(parseMi('~"line\\n"'),{token:undefined,kind:'~',text:'line\n'})
  assert.equal(parseMi('(gdb)'),null)
})

for(const language of ['c','cpp'])test(`GDB steps real ${language} locals, stdin, watches and function frames`,{skip:!available(paths[language],['--version'])||!available(paths.gdb,['--version'])},async t=>{
  const debug=createDebugSessions();t.after(()=>debug.close())
  const {id}=debug.start({language,stdin:'3 5\n',code:'#include <stdio.h>\nint twice(int n) {\n int result = n * 2;\n return result;\n}\nint main() {\n int a = 0, b = 0;\n scanf("%d %d", &a, &b);\n int total = a + b;\n total = twice(total);\n printf("%d\\n", total);\n return 0;\n}',breakpoints:[10]})
  await settled(debug,id);await debug.command(id,{action:'continue'})
  let value=await settled(debug,id);assert.equal(value.line,10,JSON.stringify(value));assert.equal(value.variables.find(v=>v.name==='total').value,'8')
  await debug.command(id,{action:'configure',watches:['a + b'],breakpoints:[3]})
  assert.equal(debug.get(id).watches[0].value,'8')
  await debug.command(id,{action:'continue'});value=await settled(debug,id)
  assert.equal(value.line,3);assert.equal(value.frames[0].name,'twice');assert.equal(value.variables.find(v=>v.name==='n').value,'8')
  await debug.command(id,{action:'out'});value=await settled(debug,id)
  assert.equal(value.status,'paused');await debug.command(id,{action:'continue'});value=await settled(debug,id)
  assert.equal(value.status,'finished',value.stderr);assert.equal(value.stdout.trim(),'16');assert.equal(value.exitCode,0)
})
