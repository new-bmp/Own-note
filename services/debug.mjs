import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import { toolchainPaths, executionEnv } from './toolchains.mjs'
import { parseMi } from './gdb-mi.mjs'

const supported=new Set(['javascript','typescript','python','c','cpp']),limit=262144
const compact=value=>String(value??'').slice(0,4000)
function kill(child){if(!child||child.exitCode!==null)return;if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());else{try{process.kill(-child.pid,'SIGKILL')}catch{child.kill()}}}
export function createDebugSessions(){
  const sessions=new Map()
  const view=session=>Object.fromEntries(['id','language','status','line','reason','frames','variables','watches','stdout','stderr','exitCode','breakpoints','expressions'].map(k=>[k,session[k]]))
  function append(session,key,text){if(session[key].length+text.length>limit){session.reason='调试输出超过 256 KB，已停止。';finish(session,'stopped');return}session[key]+=text}
  function finish(session,status,code){if(session.terminal)return;session.terminal=true;session.status=status;session.exitCode=code;if(status==='finished')session.reason='运行完成';else if(status==='error')session.reason='运行出错';clearTimeout(session.timer);clearInterval(session.outputTimer);session.transport?.destroy?.();session.server?.close();session.ws?.close();kill(session.child);session.child=undefined;session.finishedAt=Date.now();if(session.directory)void rm(session.directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{})}
  function running(session){session.status='running';clearTimeout(session.timer);session.timer=setTimeout(()=>{session.reason='连续运行超过 30 秒，已停止调试。';finish(session,'stopped')},30000)}
  function paused(session){clearTimeout(session.timer);session.status='paused';session.timer=setTimeout(()=>{session.reason='调试暂停超过 30 分钟，已释放进程。';finish(session,'stopped')},1800000)}
  function launch(session,command,args,extra={}){
    if(session.terminal)throw new Error('调试会话已停止。')
    const child=spawn(command,args,{cwd:session.directory,windowsHide:true,detached:process.platform!=='win32',env:executionEnv(session.directory,extra),stdio:['pipe','pipe','pipe']});session.child=child
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdin.on('error',()=>{})
    child.on('error',error=>{append(session,'stderr',error.message);finish(session,'error',1)})
    return child
  }
  async function nodeEngine(session,input){
    const filename=path.join(session.directory,'main.mjs')
    await writeFile(filename,input.language==='typescript'?stripTypeScriptTypes(input.code):input.code)
    if(session.terminal)return
    const child=launch(session,process.execPath,['--inspect-brk=127.0.0.1:0','--no-warnings',filename]);let connected=false,stderr=''
    child.stdout.on('data',text=>append(session,'stdout',text))
    child.stderr.on('data',text=>{
      stderr+=text
      const url=stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/)?.[0]
      if(url&&!connected){connected=true;void connect(url).catch(error=>{append(session,'stderr',error.message);finish(session,'error',1)})}
      const content=text.split('\n').filter(line=>!/^Debugger (listening|attached)|^For help, see:|^Waiting for the debugger/.test(line)).join('\n')
      if(content.trim())append(session,'stderr',content)
      if(stderr.includes('Waiting for the debugger to disconnect.')){session.ws?.close();}
    })
    child.on('close',code=>finish(session,code===0?'finished':'error',code));child.stdin.end(input.stdin)
    async function connect(url){
      if(session.terminal)return
      const socket=new WebSocket(url);session.ws=socket;const pending=new Map();let sequence=0,frameId
      const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`调试器响应超时：${method}`))},8000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
      function remoteValue(value){if(!value)return '未初始化';if(value.type==='undefined')return 'undefined';if(value.type==='string')return JSON.stringify(value.value);if(value.value!==undefined)return compact(value.value);const preview=value.preview?.properties?.slice(0,12).map(p=>`${p.name}: ${p.value??p.type}`).join(', ');return compact(preview?`${value.description||value.type} { ${preview} }`:value.unserializableValue||value.description||value.type)}
      async function scopes(frames){
        const frame=frames[session.frameIndex||0]||frames[0];if(!frame)return
        frameId=frame.callFrameId;session.line=frame.location.lineNumber+1;session.variables=[]
        const names=new Set()
        for(const scope of frame.scopeChain.filter(s=>['local','closure','module','script','block','catch'].includes(s.type))){
          const props=await call('Runtime.getProperties',{objectId:scope.object.objectId,ownProperties:true,generatePreview:true})
          for(const prop of props.result||[]){if(names.has(prop.name)||session.variables.length>=100)continue;names.add(prop.name);session.variables.push({name:prop.name,value:remoteValue(prop.value),type:prop.value?.type||'unknown',scope:scope.type})}
        }
        session.watches=[]
        for(const expression of session.expressions){const result=await call('Debugger.evaluateOnCallFrame',{callFrameId:frameId,expression,throwOnSideEffect:true,generatePreview:true,silent:true});session.watches.push({name:expression,value:result.exceptionDetails?compact(result.exceptionDetails.exception?.description||result.exceptionDetails.text):remoteValue(result.result),error:!!result.exceptionDetails})}
      }
      let callFrames=[]
      socket.addEventListener('message',event=>{void(async()=>{
        const message=JSON.parse(String(event.data))
        if(message.id){const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result)}return}
        if(message.method==='Debugger.paused'){
          callFrames=message.params.callFrames.filter(frame=>frame.url===pathToFileURL(filename).href||frame.location.scriptId===session.scriptId)
          session.frames=callFrames.map(frame=>({name:frame.functionName||'主程序',line:frame.location.lineNumber+1}));session.frameIndex=0;session.reason=message.params.reason==='exception'?'异常暂停':'单步暂停'
          try{await scopes(callFrames);if(!session.terminal)paused(session)}catch(error){append(session,'stderr',error.message);finish(session,'error',1)}
        }
        if(message.method==='Debugger.scriptParsed'&&message.params.url===pathToFileURL(filename).href)session.scriptId=message.params.scriptId
      })().catch(error=>{append(session,'stderr',error.message);finish(session,'error',1)})})
      await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(new Error('无法连接 Node 调试器。')),{once:true})})
      await call('Runtime.enable');await call('Debugger.enable');await call('Debugger.setPauseOnExceptions',{state:'uncaught'})
      const breakpointIds=[]
      async function configure(){for(const breakpointId of breakpointIds.splice(0))await call('Debugger.removeBreakpoint',{breakpointId});for(const line of session.breakpoints){const point=await call('Debugger.setBreakpointByUrl',{lineNumber:line-1,url:pathToFileURL(filename).href});breakpointIds.push(point.breakpointId)}if(session.status==='paused')await scopes(callFrames)}
      session.command=async(action,args)=>{if(action==='configure')return configure();if(action==='frame'){session.frameIndex=args.index;return scopes(callFrames)}const method={next:'stepOver',step:'stepInto',out:'stepOut',continue:'resume',pause:'pause'}[action];if(action!=='pause')running(session);await call('Debugger.'+method)}
      await configure();await call('Runtime.runIfWaitingForDebugger')
    }
  }
  async function pythonEngine(session,input){
    const token=randomUUID(),filename=path.join(session.directory,'main.py');await writeFile(filename,input.code)
    if(session.terminal)return
    const server=createServer();session.server=server;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    server.on('connection',socket=>{let data='',authenticated=false;socket.setEncoding('utf8');socket.on('error',()=>{});socket.setTimeout(10000,()=>{if(!authenticated)socket.destroy()});socket.on('data',text=>{data+=text;if(data.length>1000000)return socket.destroy();let newline;while((newline=data.indexOf('\n'))>=0){const line=data.slice(0,newline);data=data.slice(newline+1);try{const message=JSON.parse(line);if(!authenticated){const received=Buffer.from(String(message.token||'')),expected=Buffer.from(token);if(received.length!==expected.length||!timingSafeEqual(received,expected))return socket.destroy();authenticated=true;socket.setTimeout(0);session.transport=socket;server.close();session.command=async(action)=>{socket.write(JSON.stringify({action,breakpoints:session.breakpoints,watches:session.expressions})+'\n');if(['next','step','out','continue'].includes(action))running(session)};socket.write(JSON.stringify({action:'configure',breakpoints:session.breakpoints,watches:session.expressions})+'\n');}else if(message.event==='paused'){Object.assign(session,{line:message.line,reason:message.reason,frames:message.frames,variables:message.variables,watches:message.watches});paused(session)}}catch{socket.destroy()}}})})
    const child=launch(session,toolchainPaths().python,['-I','-u',fileURLToPath(new URL('./python-debug.py',import.meta.url)),filename],{OWN_DEBUG_PORT:String(server.address().port),OWN_DEBUG_TOKEN:token})
    child.stdout.on('data',text=>append(session,'stdout',text));child.stderr.on('data',text=>append(session,'stderr',text));child.on('close',code=>finish(session,code===0?'finished':'error',code));child.stdin.end(input.stdin)
  }
  async function gdbEngine(session,input){
    const paths=toolchainPaths(),filename=path.join(session.directory,input.language==='c'?'main.c':'main.cpp'),executable=path.join(session.directory,'main.exe')
    await writeFile(filename,input.code);await writeFile(path.join(session.directory,'input.txt'),input.stdin)
    if(session.terminal)return
    const compiler=launch(session,paths[input.language],['-g','-O0','-fno-omit-frame-pointer','-no-canonical-prefixes',filename,'-o',executable]);compiler.stdout.on('data',text=>append(session,'stdout',text));compiler.stderr.on('data',text=>append(session,'stderr',text));compiler.stdin.end()
    clearTimeout(session.timer);session.timer=setTimeout(()=>{session.reason='编译超时。';finish(session,'stopped')},60000)
    const code=await new Promise(resolve=>{compiler.on('exit',resolve);compiler.on('error',()=>resolve(1))});if(session.terminal)return;if(code!==0){finish(session,'error',code);return}
    const child=launch(session,paths.gdb,['--quiet','--nx','--interpreter=mi2',executable]);let buffer='',sequence=0
    const pending=new Map(),quote=value=>JSON.stringify(value)
    const call=command=>new Promise((resolve,reject)=>{const token=++sequence,timer=setTimeout(()=>{pending.delete(token);reject(new Error('GDB 响应超时。'))},8000);pending.set(token,{resolve,reject,timer});child.stdin.write(token+command+'\n')})
    async function outputs(){for(const [key,name]of [['stdout','output.txt'],['stderr','error.txt']]){try{const value=await readFile(path.join(session.directory,name),'utf8');if(value.length>limit){session.reason='调试输出超过 256 KB。';finish(session,'stopped');return}session[key]=value}catch{}}}
    async function locals(){
      const values=await call('-stack-list-variables --all-values');session.variables=(values.variables||[]).slice(0,100).map(v=>({name:v.name,value:compact(v.value??'未初始化'),type:v.type||'',scope:'局部'}));session.watches=[]
      for(const expression of session.expressions){try{if(/(?<![=!<>])=(?!=)|\+\+|--|[;{}]|(?:[\w$\]\)])\s*\(|\b(?:new|delete)\b/.test(expression))throw new Error('观察表达式只能读取变量、下标和简单算术，不能调用函数或修改值。');const result=await call('-data-evaluate-expression '+quote(expression));session.watches.push({name:expression,value:compact(result.value)})}catch(error){session.watches.push({name:expression,value:error.message,error:true})}}
    }
    child.stdout.on('data',text=>{buffer+=text;let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);const message=parseMi(line);if(!message)continue;if(message.kind==='^'&&message.token){const item=pending.get(message.token);if(item){clearTimeout(item.timer);pending.delete(message.token);message.name==='error'?item.reject(new Error(message.data.msg)):item.resolve(message.data)}}else if(message.kind==='*'&&message.name==='stopped'){void(async()=>{await outputs();if(message.data.reason?.startsWith('exited')){finish(session,message.data.reason==='exited-normally'?'finished':'error',Number(message.data['exit-code']||0));return}session.reason=message.data.reason;session.line=Number(message.data.frame?.line||0);const frames=await call('-stack-list-frames 0 24');session.frames=(frames.stack||[]).map(item=>({name:item.frame?.func||'主程序',line:Number(item.frame?.line||0)}));await locals();if(!session.terminal)paused(session)})().catch(error=>{append(session,'stderr',error.message);finish(session,'error',1)})}}})
    child.stderr.on('data',text=>append(session,'stderr',text));child.on('exit',code=>{if(!session.terminal)finish(session,'error',code??1)})
    await call('-gdb-set pagination off');await call('-gdb-set confirm off');await call('-gdb-set mi-async on');await call('-gdb-set may-call-functions off');await call('-environment-cd '+quote(session.directory));await call('-gdb-set new-console off')
    const breakpoints=[]
    async function configure(){for(const id of breakpoints.splice(0))await call('-break-delete '+id);for(const line of session.breakpoints){const result=await call('-break-insert '+quote(filename+':'+line));breakpoints.push(result.bkpt.number)}if(session.status==='paused')await locals()}
    session.command=async(action,args)=>{if(action==='configure')return configure();if(action==='frame'){await call('-stack-select-frame '+Math.max(0,args.index||0));session.line=session.frames[args.index]?.line||session.line;return locals()}if(action!=='pause')running(session);await call({next:'-exec-next',step:'-exec-step',out:'-exec-finish',continue:'-exec-continue',pause:'-exec-interrupt --all'}[action])}
    await configure();await call('-break-insert -t main');running(session);session.outputTimer=setInterval(()=>void outputs(),250)
    await call('-interpreter-exec console '+quote('run < input.txt > output.txt 2> error.txt'))
  }
  function validateConfig(input){if(input.breakpoints!==undefined&&(!Array.isArray(input.breakpoints)||input.breakpoints.length>100||!input.breakpoints.every(v=>Number.isInteger(v)&&v>=1&&v<=10000)))throw new Error('断点必须是有效行号，最多 100 个。');if(input.watches!==undefined&&(!Array.isArray(input.watches)||input.watches.length>20||!input.watches.every(v=>typeof v==='string'&&v.length>0&&v.length<=500)))throw new Error('最多 20 个观察表达式，每个 500 字符。')}
  return {
    start(input){
      if(!input||!supported.has(input.language)||typeof input.code!=='string'||input.code.length>100000||typeof input.stdin!=='string'||input.stdin.length>64000)throw new Error('调试支持 JavaScript、TypeScript、Python、C 和 C++，请检查代码与输入。')
      validateConfig(input)
      if([...sessions.values()].filter(s=>!s.terminal).length>=2)throw new Error('最多同时调试 2 个单元，请先停止其他会话。')
      for(const [id,s]of sessions)if(s.terminal&&Date.now()-s.finishedAt>3600000)sessions.delete(id)
      const session={id:randomUUID(),language:input.language,status:'starting',line:0,frames:[],variables:[],watches:[],stdout:'',stderr:'',breakpoints:input.breakpoints||[],expressions:input.watches||[]};sessions.set(session.id,session);running(session);session.status='starting'
      void(async()=>{session.directory=await mkdtemp(path.join(tmpdir(),'own-debug-'));if(session.terminal){await rm(session.directory,{recursive:true,force:true});return}await (['javascript','typescript'].includes(input.language)?nodeEngine:input.language==='python'?pythonEngine:gdbEngine)(session,input)})().catch(error=>{append(session,'stderr',error.message);finish(session,'error',1)})
      return view(session)
    },
    get(id){const session=sessions.get(id);if(!session)throw new Error('调试会话已过期。');return view(session)},
    async command(id,input){const session=sessions.get(id);if(!session)throw new Error('调试会话已过期。');const action=input?.action;if(action==='stop'){finish(session,'stopped');return view(session)}if(!['next','step','out','continue','pause','configure','frame'].includes(action))throw new Error('未知调试动作。');if(session.terminal||!session.command)throw new Error('调试器尚未就绪，或会话已结束。');if(action!=='pause'&&session.status!=='paused')throw new Error('请等待代码暂停后操作。');validateConfig(input);if(input.breakpoints!==undefined)session.breakpoints=input.breakpoints;if(input.watches!==undefined)session.expressions=input.watches;if(action==='frame'&&(!Number.isInteger(input.index)||input.index<0||input.index>=session.frames.length))throw new Error('调用栈帧无效。');await session.command(action,input);return view(session)},
    close(){for(const session of sessions.values())finish(session,'stopped')},
  }
}
