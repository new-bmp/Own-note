import { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { StreamLanguage } from '@codemirror/language'
import { go } from '@codemirror/legacy-modes/mode/go'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { csharp } from '@codemirror/legacy-modes/mode/clike'
import type { Extension } from '@codemirror/state'
import type { CanvasNote, CodeCell } from './model'
import { uid } from './model'
import { labRequest, watchJob } from './lab-api'
import type { LabJob } from './lab-api'
import { Play, Square, Plus, Trash2, ChevronUp, ChevronDown, Download } from 'lucide-react'
import { downloadFile } from './storage'
import { StepDebugger } from './StepDebugger'
const languages=[['javascript','JavaScript'],['typescript','TypeScript'],['python','Python'],['sql','SQL / SQLite'],['html','HTML'],['css','CSS'],['json','JSON'],['cpp','C++'],['c','C'],['java','Java'],['go','Go'],['rust','Rust'],['csharp','C#'],['shell','Shell'],['markdown','Markdown']] as const
const syntaxes:Record<string,()=>Extension>={javascript:()=>javascript(),typescript:()=>javascript({typescript:true}),python,sql,html,css,json,cpp,c:cpp,java,rust,go:()=>StreamLanguage.define(go),shell:()=>StreamLanguage.define(shell),csharp:()=>StreamLanguage.define(csharp)}
const syntax=(language:string)=>syntaxes[language]?.()||[]
const samples:Record<string,{code:string;stdin:string;expected?:string}>={
 javascript:{code:'const text = await new Promise(resolve => { let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => resolve(s)); });\nconsole.log(text.trim().split(/\\s+/).map(Number).reduce((a,b) => a+b, 0));',stdin:'3 5 8',expected:'16\n'},
 typescript:{code:'const square = (n: number): number => n * n;\nconsole.log(square(12));',stdin:'',expected:'144\n'},
 python:{code:'numbers = list(map(float, input().split()))\nprint(sum(numbers))',stdin:'3 5 8',expected:'16.0\n'},
 sql:{code:"CREATE TABLE scores (name TEXT, score REAL);\nINSERT INTO scores VALUES ('数学', 92), ('物理', 88);\nSELECT AVG(score) AS average FROM scores;",stdin:''},
 html:{code:'<!doctype html>\n<html lang="zh"><meta charset="utf-8"><style>body {font:18px system-ui;padding:24px;color:#283d55}button {padding:10px}</style><h1>交互示例</h1><button onclick="this.textContent=\'已点击\'">点一下试试</button></html>',stdin:''},
 cpp:{code:'#include <iostream>\nint main(){ int a,b; std::cin >> a >> b; std::cout << a+b << std::endl; }',stdin:'3 5',expected:'8\n'},
 c:{code:'#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',stdin:'3 5',expected:'8\n'},
 java:{code:'class Main { public static void main(String[] args) { System.out.println("Hello Own"); } }',stdin:''},
 go:{code:'package main\nimport "fmt"\nfunc main(){fmt.Println("Hello Own")}',stdin:''},rust:{code:'fn main() { println!("Hello Own"); }',stdin:''},
 json:{code:'{"name": "Own", "topics": ["code", "notes"]}',stdin:''},css:{code:'body { color: #283d55; font: 18px system-ui; }',stdin:''},csharp:{code:'Console.WriteLine("Hello Own");',stdin:''},shell:{code:'printf "Hello Own\\n"',stdin:''},markdown:{code:'# 学习记录\n\n写下实验目的、观察与结论。',stdin:''},
}
export function CodeNotebook({note,onChange,onBusy}:{note:CanvasNote;onChange:(patch:Partial<CanvasNote>)=>void;onBusy:(busy:boolean)=>void}){
  const [runtime,setRuntime]=useState<{languages:{id:string;available:boolean;version:string}[];debugging?:string[]}>()
  const [debugging,setDebugging]=useState<string>()
  const [jobs,setJobs]=useState<Record<string,LabJob>>({}),[message,setMessage]=useState(''),[htmlOutputs,setHtmlOutputs]=useState<Record<string,string>>({}),[starting,setStarting]=useState<Record<string,boolean>>({})
  const runLocks=useRef(new Set<string>())
  const active=useRef(new Map<string,{controller:AbortController;jobId:string}>()),alive=useRef(true)
  const cells=note.cells||[],cellsRef=useRef(cells);cellsRef.current=cells
  const changeRef=useRef(onChange);changeRef.current=onChange
  useEffect(()=>{alive.current=true;void labRequest<typeof runtime>('/api/lab/runtimes').then(setRuntime).catch(e=>setMessage(e.message));return()=>{alive.current=false;for(const {controller,jobId}of active.current.values()){controller.abort();void labRequest(`/api/lab/jobs/${jobId}`,undefined,'DELETE').catch(()=>{})}}},[])
  const patch=(id:string,fields:Partial<CodeCell>)=>changeRef.current({cells:cellsRef.current.map(c=>c.id===id?{...c,...fields}:c)})
  async function run(cell:CodeCell){
    if(runLocks.current.has(cell.id))return
    setMessage('')
    const execution={executedCode:cell.code,executedLanguage:cell.language,executedInput:cell.stdin,executedAt:Date.now(),executionCount:(cell.executionCount||0)+1}
    setJobs(current=>{const next={...current};delete next[cell.id];return next})
    if(cell.language==='html'){setHtmlOutputs(v=>({...v,[cell.id]:cell.code}));patch(cell.id,{...execution,output:'',error:'',exitCode:0});return}
    setHtmlOutputs(v=>{const next={...v};delete next[cell.id];return next})
    if(cell.language==='json'){try{patch(cell.id,{...execution,output:JSON.stringify(JSON.parse(cell.code),null,2),error:'',exitCode:0})}catch(e){patch(cell.id,{...execution,output:'',error:String(e),exitCode:1})}return}
    runLocks.current.add(cell.id);setStarting(v=>({...v,[cell.id]:true}))
    onBusy(true)
    try{
      const job=await labRequest<LabJob>('/api/lab/code',{language:cell.language,code:cell.code,stdin:cell.stdin,timeoutMs:15000})
      if(!alive.current){void labRequest(`/api/lab/jobs/${job.id}`,undefined,'DELETE').catch(()=>{});return}
      const controller=new AbortController();active.current.set(cell.id,{controller,jobId:job.id});setJobs(v=>({...v,[cell.id]:job}))
      setStarting(v=>({...v,[cell.id]:false}))
      const done=await watchJob(job.id,p=>{if(alive.current)setJobs(v=>({...v,[cell.id]:p}))},controller.signal)
      if(done&&alive.current)patch(cell.id,{...execution,executedAt:Date.now(),output:done.stdout,error:[done.stderr,done.reason].filter(Boolean).join('\n'),exitCode:done.exitCode??1})
    }catch(e){if(alive.current)setMessage(String(e))}finally{active.current.delete(cell.id);runLocks.current.delete(cell.id);if(alive.current){setStarting(v=>({...v,[cell.id]:false}));onBusy(runLocks.current.size>0)}}
  }
  return <div className="code-notebook">
    <p className="lab-help">运行查看完整输出，或选择「单步调试」逐行执行、查看变量和调用栈。支持 JavaScript、TypeScript、Python、C / C++ 调试。Shift + Enter 运行单元。</p>
    {message&&<p role="alert" className="lab-error">{message}</p>}
    {cells.map((cell,index)=>{const job=jobs[cell.id],running=job?.status==='running'||starting[cell.id],debugOpen=debugging===cell.id,capability=runtime?.languages.find(r=>r.id===cell.language),canRun=!debugging&&(['html','json'].includes(cell.language)||capability?.available)
      const stdout=job?job.stdout:cell.output||'',stderr=job?[job.stderr,job.reason].filter(Boolean).join('\n'):cell.error||''
      return <section key={cell.id} className="code-cell" aria-label={`代码单元 ${index+1}`} onKeyDown={event=>{if(event.shiftKey&&event.key==='Enter'){event.preventDefault();if(!running&&canRun)void run(cell)}}}>
        <header><span className="cell-count">[{cell.executionCount||' '}]</span><select aria-label={`单元 ${index+1} 语言`} value={cell.language} disabled={running||debugOpen} onChange={e=>patch(cell.id,{language:e.target.value})}>{languages.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
          <button disabled={running||debugOpen} onClick={()=>{if(confirm('用该语言示例替换此单元的源码和输入？'))patch(cell.id,{...samples[cell.language],output:undefined,error:undefined,executedCode:undefined})}}>载入示例</button>
          <span className="cell-runtime">{capability?.version||(['css','csharp','shell','markdown'].includes(cell.language)?'语法编辑与示例记录':cell.language==='json'?'格式化与校验':'检测运行环境…')}</span>
          {running?<button disabled={!job} onClick={()=>job&&void labRequest(`/api/lab/jobs/${job.id}`,undefined,'DELETE').catch(e=>setMessage(e.message))}><Square size={14}/>{job?'停止':'启动中…'}</button>:<button disabled={!canRun} onClick={()=>void run(cell)}><Play size={14}/>{cell.language==='html'?'预览':'运行'}</button>}
        </header>
        {!debugOpen&&runtime?.debugging?.includes(cell.language)&&<div className="lab-actions"><button disabled={!!debugging||Object.values(starting).some(Boolean)||Object.values(jobs).some(j=>j.status==='running')} onClick={()=>{setJobs(current=>{const next={...current};delete next[cell.id];return next});setHtmlOutputs(current=>{const next={...current};delete next[cell.id];return next});setDebugging(cell.id)}}>单步调试</button></div>}
        {debugOpen?<StepDebugger cell={cell} onBusy={busy=>onBusy(busy||runLocks.current.size>0)} onResult={result=>patch(cell.id,result)} onClose={()=>setDebugging(undefined)}/>:<CodeMirror value={cell.code} height="260px" extensions={[syntax(cell.language)].flat()} onChange={value=>patch(cell.id,{code:value})} editable={!running} basicSetup={{lineNumbers:true,foldGutter:true,highlightActiveLine:true,autocompletion:true}} aria-label={`单元 ${index+1} 源码`} />}
        <div className="cell-io"><label>标准输入 stdin<textarea aria-label={`单元 ${index+1} 输入`} value={cell.stdin} disabled={running||debugOpen} onChange={e=>patch(cell.id,{stdin:e.target.value})} placeholder="模拟键盘输入，多行可用"/></label><label>预期输出（可选）<textarea aria-label={`单元 ${index+1} 预期输出`} value={cell.expected||''} onChange={e=>patch(cell.id,{expected:e.target.value})}/></label></div>
        {htmlOutputs[cell.id]&&<iframe title={`单元 ${index+1} HTML 预览`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; form-action \'none\'">'+htmlOutputs[cell.id]} />}
        {!debugOpen&&(stdout||stderr||running)&&<div className="cell-output" aria-live="polite"><strong>{running?'运行中…':`输出 · 退出码 ${job?.exitCode??cell.exitCode??0}`}</strong><pre>{stdout}</pre>{stderr&&<pre className="lab-error">{stderr}</pre>}{cell.expected!==undefined&&!running&&<span className={stdout.replaceAll('\r\n','\n')===cell.expected.replaceAll('\r\n','\n')?'lab-pass':'lab-error'}>{stdout.replaceAll('\r\n','\n')===cell.expected.replaceAll('\r\n','\n')?'与预期输出一致':'与预期输出不同'}</span>}</div>}
        {cell.executedCode!==undefined&&(cell.executedCode!==cell.code||cell.executedLanguage!==cell.language||cell.executedInput!==cell.stdin)&&<p className="lab-warning">源码、语言或输入已修改，当前输出来自上次运行。</p>}
        <footer><button disabled={index===0||running||debugOpen} onClick={()=>{const next=[...cells];[next[index-1],next[index]]=[next[index],next[index-1]];onChange({cells:next})}}><ChevronUp size={14}/>上移</button><button disabled={index===cells.length-1||running||debugOpen} onClick={()=>{const next=[...cells];[next[index+1],next[index]]=[next[index],next[index+1]];onChange({cells:next})}}><ChevronDown size={14}/>下移</button><button onClick={()=>downloadFile(new Blob([cell.code],{type:'text/plain'}),`单元-${index+1}.${({javascript:'mjs',typescript:'ts',python:'py',cpp:'cpp',csharp:'cs',shell:'sh'}as Record<string,string>)[cell.language]||cell.language}`)}><Download size={14}/>源码</button><button disabled={cells.length===1||running||debugOpen} onClick={()=>onChange({cells:cells.filter(c=>c.id!==cell.id)})}><Trash2 size={14}/>删除单元</button></footer>
      </section>})}
    <button className="secondary-button" disabled={cells.length>=40} onClick={()=>onChange({cells:[...cells,{id:uid(),language:'javascript',code:'console.log("Hello Own");',stdin:''}]})}><Plus size={15}/>添加代码单元</button>
  </div>
}
