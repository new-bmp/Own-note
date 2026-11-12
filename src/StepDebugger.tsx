import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, StepForward, ArrowDownToLine, ArrowUpFromLine, Plus, X } from 'lucide-react'
import type { CodeCell } from './model'
import { labRequest } from './lab-api'

export interface DebugState {
  id:string; language:string; status:'starting'|'running'|'paused'|'finished'|'error'|'stopped'; line:number; reason?:string; exitCode?:number
  frames:{name:string;line:number}[]; variables:{name:string;value:string;type:string;scope:string}[]; watches:{name:string;value:string;error?:boolean}[]
  stdout:string;stderr:string;breakpoints:number[];expressions:string[]
}
export function StepDebugger({cell,onBusy,onResult,onClose}:{cell:CodeCell;onBusy:(busy:boolean)=>void;onResult:(result:Partial<CodeCell>)=>void;onClose:()=>void}){
  const [state,setState]=useState<DebugState>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[watch,setWatch]=useState(''),[filter,setFilter]=useState('')
  const [breakpoints,setBreakpoints]=useState<number[]>([]),[expressions,setExpressions]=useState<string[]>([])
  const session=useRef<string|undefined>(undefined),reported=useRef(false),lineRef=useRef<HTMLLIElement>(null),sourceRef=useRef<HTMLOListElement>(null)
  const resultRef=useRef(onResult);resultRef.current=onResult
  const busyRef=useRef(onBusy);busyRef.current=onBusy
  const terminal=state&&['finished','error','stopped'].includes(state.status)
  useEffect(()=>{
    let mounted=true,currentId:string|undefined;reported.current=false;onBusy(true);let timer:ReturnType<typeof setTimeout>
    const update=(value:DebugState)=>{if(!mounted)return;setState(value);if(['finished','error','stopped'].includes(value.status)&&!reported.current){reported.current=true;busyRef.current(false);resultRef.current({output:value.stdout,error:[value.stderr,value.status==='finished'?'':value.reason].filter(Boolean).join('\n'),exitCode:value.exitCode??(value.status==='finished'?0:1),executedCode:cell.code,executedLanguage:cell.language,executedInput:cell.stdin,executedAt:Date.now(),executionCount:(cell.executionCount||0)+1})}}
    async function poll(){if(!mounted||!session.current)return;try{update(await labRequest<DebugState>(`/api/lab/debug/${session.current}`))}catch(e){if(mounted)setError(String(e))}if(mounted&&!reported.current)timer=setTimeout(()=>void poll(),300)}
    void labRequest<DebugState>('/api/lab/debug',{language:cell.language,code:cell.code,stdin:cell.stdin}).then(value=>{if(!mounted){void labRequest(`/api/lab/debug/${value.id}`,{action:'stop'});return}currentId=value.id;session.current=value.id;update(value);timer=setTimeout(()=>void poll(),150)}).catch(e=>{if(mounted){setError(String(e));onBusy(false)}})
    return()=>{mounted=false;clearTimeout(timer);if(currentId)void labRequest(`/api/lab/debug/${currentId}`,{action:'stop'}).catch(()=>{});busyRef.current(false)}
    // The mounted debugger always runs the captured version of this cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  useEffect(()=>{
    const source=sourceRef.current,line=lineRef.current
    if(!source||!line)return
    const top=line.offsetTop,bottom=top+line.offsetHeight
    if(top<source.scrollTop)source.scrollTop=top
    else if(bottom>source.scrollTop+source.clientHeight)source.scrollTop=bottom-source.clientHeight
  },[state?.line])
  async function command(action:string,extra:Record<string,unknown>={}){if(!session.current)return;setPending(true);setError('');try{setState(await labRequest<DebugState>(`/api/lab/debug/${session.current}`,{action,...extra}))}catch(e){setError(String(e))}finally{setPending(false)}}
  function configure(points:number[],watches:string[]){setBreakpoints(points);setExpressions(watches);void command('configure',{breakpoints:points,watches})}
  const paused=state?.status==='paused'
  return <section className="step-debugger" aria-label="单步调试工作台">
    <div className="debug-toolbar"><strong>{state?.status==='starting'?'启动调试器…':paused?`暂停 · 第 ${state.line} 行` :state?.status==='running'?'运行中':terminal?'调试已结束':'准备调试'}</strong>
      <button disabled={!paused||pending} title="执行当前行，跳过函数内部" onClick={()=>void command('next')}><StepForward size={15}/>下一步</button>
      <button disabled={!paused||pending} title="进入当前函数" onClick={()=>void command('step')}><ArrowDownToLine size={15}/>进入函数</button>
      <button disabled={!paused||pending||!state?.frames.length||state.frames.length<2} onClick={()=>void command('out')}><ArrowUpFromLine size={15}/>跳出函数</button>
      <button disabled={pending||!state||terminal||state.status==='starting'} onClick={()=>void command(paused?'continue':'pause')}>{paused?<Play size={15}/>:<Pause size={15}/>} {paused?'继续到断点':'暂停'}</button>
      <button disabled={!state||terminal||pending} onClick={()=>void command('stop')}><Square size={15}/>停止</button>
      <button disabled={!!state&&!terminal} onClick={onClose}><X size={15}/>返回编辑</button>
    </div>
    <p className="lab-help">高亮行将在下一步执行。暂停时点击行号设置断点；右侧查看变量或添加观察表达式。运行结束后输出保留在单元中。</p>
    {error&&<p className="lab-error" role="alert">{error}</p>}
    <div className="debug-layout"><ol ref={sourceRef} className="debug-source" aria-label="调试源码">{cell.code.split('\n').map((line,index)=><li key={index} className={state?.line===index+1&&paused?'execution-line':''} ref={state?.line===index+1?lineRef:undefined}><button aria-label={`第 ${index+1} 行断点`} aria-pressed={breakpoints.includes(index+1)} disabled={!paused||pending} onClick={()=>configure(breakpoints.includes(index+1)?breakpoints.filter(v=>v!==index+1):[...breakpoints,index+1],expressions)}>{breakpoints.includes(index+1)?'●':index+1}</button><code>{line||' '}</code></li>)}</ol>
      <aside className="debug-inspector"><h3>变量 <small>{paused?'当前暂停位置':'暂停后更新'}</small></h3><input aria-label="筛选变量" placeholder="筛选变量名" value={filter} onChange={e=>setFilter(e.target.value)}/><div className="debug-variables"><table><thead><tr><th>变量</th><th>值</th></tr></thead><tbody>{state?.variables.filter(v=>v.name.toLowerCase().includes(filter.toLowerCase())).map((v,i)=><tr key={i}><th title={`${v.scope} · ${v.type}`}>{v.name}<small>{v.type}</small></th><td><code>{v.value}</code></td></tr>)}</tbody></table>{!state?.variables.length&&<p>当前作用域尚无可查看变量。</p>}</div>
      <h3>观察表达式</h3><form className="debug-watch-form" onSubmit={event=>{event.preventDefault();if(watch.trim()&&!expressions.includes(watch.trim())){configure(breakpoints,[...expressions,watch.trim()]);setWatch('')}}}><input aria-label="观察表达式" placeholder="例如 total、items[0]" maxLength={500} value={watch} onChange={e=>setWatch(e.target.value)}/><button disabled={!paused||pending||!watch.trim()||expressions.length>=20} aria-label="添加观察表达式"><Plus size={16}/></button></form>
      {state?.watches.map(v=><div className={`debug-watch ${v.error?'lab-error':''}`} key={v.name}><strong>{v.name}</strong><button disabled={!paused||pending} aria-label={`移除观察 ${v.name}`} onClick={()=>configure(breakpoints,expressions.filter(e=>e!==v.name))}><X size={13}/></button><code>{v.value}</code></div>)}
      <h3>调用栈</h3>{state?.frames.map((frame,index)=><button disabled={!paused||pending||cell.language==='python'} className="debug-frame" key={index} onClick={()=>void command('frame',{index})}>{frame.name}<span>第 {frame.line} 行</span></button>)}
      </aside></div>
    <div className="cell-output" aria-live="polite"><strong>实际输出</strong><pre>{state?.stdout||'尚无输出'}</pre>{state?.stderr&&<pre className="lab-error">{state.stderr}</pre>}{terminal&&<span>退出码 {state.exitCode??'—'} · {state.reason||state.status}</span>}</div>
  </section>
}
