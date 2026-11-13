import { lazy, Suspense, useEffect, useState } from 'react'
import type { CanvasNote, Board } from './model'
import { Code2, ChartColumn, Bot, Cpu, X, Check, ExternalLink } from 'lucide-react'
import { RichPreview } from './RichContent'
import { agentOnline } from '../shared/concepts.js'
import { conceptReady, conceptDependencyError } from '../shared/concepts.js'
const CodeNotebook=lazy(()=>import('./CodeNotebook').then(m=>({default:m.CodeNotebook})))
const ProgrammableBlock=lazy(()=>import('./ProgrammableBlock').then(m=>({default:m.ProgrammableBlock})))
const DataAnalysis=lazy(()=>import('./DataAnalysis').then(m=>({default:m.DataAnalysis})))
export const isWorkbenchNote=(note:CanvasNote)=>['program','code','analysis','concept'].includes(note.kind)
export const conceptLabels={pending:'待实现',running:'执行中',done:'已实现',blocked:'遇到阻塞',paused:'已暂停'}
export function WorkbenchCard({note,onOpen}:{note:CanvasNote;onOpen:()=>void}){
  const Icon=note.kind==='program'?Cpu:note.kind==='code'?Code2:note.kind==='analysis'?ChartColumn:Bot
  const content = note.kind === 'program' || note.kind === 'code'
    ? <><p>{note.cells?.length || 0} 个单元 · {Array.from(new Set(note.cells?.map(c => c.language))).join(' / ')}</p><pre>{note.cells?.[0]?.code.slice(0, 600)}</pre>{note.cells?.[0]?.output && <pre className="code-card-result">{note.cells[0].output.slice(0, 300)}</pre>}{note.kind === 'program' && <p className="program-card-meta">{note.programDrivers?.length || 0} 个驱动 · {note.animation?.frames.length || 0} 个动画关键帧</p>}</>
    : note.kind === 'analysis'
      ? <pre>{note.analysisSource?.slice(0, 650)}</pre>
      : <div className="concept-card-body"><RichPreview note={{ ...note, kind: 'markdown', body: note.body?.slice(0, 1200) }} />{note.concept?.progress && <p><strong>最新进展：</strong>{note.concept.progress}</p>}{note.concept?.status === 'done' && note.concept.evidence && <p><strong>验证结果：</strong>{note.concept.evidence.slice(0, 600)}</p>}</div>
  return <div className="workbench-card"><header><Icon size={16} /><span>{note.kind === 'program' ? '可编程块' : note.kind === 'code' ? '兼容代码块' : note.kind === 'analysis' ? '数据分析' : conceptLabels[note.concept!.status]}</span>{note.kind === 'concept' && <span className={`concept-status status-${note.concept!.status}`}>{note.concept!.agentId || '等待 Agent'}</span>}</header><h3>{note.title}</h3>{content}<button className="read-note-button" data-canvas-ui onClick={onOpen}><ExternalLink size={14} />{note.kind === 'concept' ? '查看构想与执行' : '打开工作台'}</button></div>
}
export function WorkbenchEditor({note,board,destination='画布',onClose,onSave,onChart}:{note:CanvasNote;board:Board;destination?:'画布'|'项目';onClose:()=>void;onSave:(patch:Partial<CanvasNote>)=>void;onChart:(note:Partial<CanvasNote>)=>void}){
  const [draft,setDraft]=useState(note),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const locked=note.kind==='concept'&&note.concept?.status==='done'
  const patch=(value:Partial<CanvasNote>)=>setDraft(current=>({...current,...value}))
  function save(){
    if(!draft.title?.trim()){setError('请填写标题。');return}
    if(draft.cells?.some(c=>c.code.length>100000||c.stdin.length>64000)){setError('代码单元超过大小限制。');return}
    if(draft.analysisSource&&draft.analysisSource.length>2000000){setError('数据源码最多 2000000 字符。');return}
    if(draft.kind==='concept'&&draft.concept){
      const dependencyError=conceptDependencyError(board.notes.map(n=>n.id===draft.id?draft:n))
      if(dependencyError){setError(dependencyError);return}
      const changed=draft.body!==note.body||draft.title!==note.title||draft.concept.acceptance!==note.concept?.acceptance||JSON.stringify(draft.concept.dependsOn)!==JSON.stringify(note.concept?.dependsOn)||draft.concept.status!==note.concept?.status
      if(changed){draft.concept={...draft.concept,lease:undefined,...(draft.concept.status==='running'?{status:'pending'}:{}),history:[...(draft.concept.history||[]),{at:Date.now(),text:'用户修改构想或状态，等待 Agent 读取最新版本。'}].slice(-200)}}
    }
    onSave(draft)
  }
  return <div className="modal-overlay workbench-overlay" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();if(!busy)onClose()}}}><section role="dialog" aria-modal="true" aria-label={`编辑${note.title}`} className="workbench-editor"><header className="workbench-editor-header"><div><strong>{note.kind==='program'?'可编程块 · 单元、动画与驱动':note.kind==='code'?'兼容代码块':note.kind==='analysis'?'数据分析工作台':'Next to do · 构想与执行'}</strong><small>{note.kind==='concept'?'修改未实现笔记，将在 Agent 下一次检查时生效。':note.kind==='program'?'支持分步运行、变量查看、动画预览与外部驱动配置。':'编辑内容会随笔记保存。'}</small></div><button className="icon-button" aria-label="关闭工作台" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <div className="workbench-editor-body"><label>标题<input aria-label="工作台笔记标题" value={draft.title||''} disabled={locked} onChange={e=>patch({title:e.target.value})}/></label>
      <Suspense fallback={<p role="status">正在打开工作台…</p>}>{note.kind==='program'?<ProgrammableBlock note={draft} onChange={patch} onBusy={setBusy}/>:note.kind==='code'?<CodeNotebook note={draft} onChange={patch} onBusy={setBusy}/>:note.kind==='analysis'?<DataAnalysis note={draft} onChange={patch} onChart={onChart} destination={destination}/>:<>
      {locked&&<p className="lab-help">此任务已有完成记录。可查看证据；需要继续修改时点击“重新打开”，保留原结果。</p>}
      <label>构想与实现要求（Markdown）<textarea className="concept-source" aria-label="构想内容" value={draft.body||''} disabled={locked} maxLength={50000} onChange={e=>patch({body:e.target.value})}/></label>
      <label>验收标准<textarea aria-label="构想验收标准" value={draft.concept?.acceptance||''} disabled={locked} maxLength={12000} onChange={e=>patch({concept:{...draft.concept!,acceptance:e.target.value}})}/></label>
      {!locked&&<><label>任务状态<select aria-label="构想任务状态" value={draft.concept?.status} onChange={e=>patch({concept:{...draft.concept!,status:e.target.value as 'pending'|'paused'|'blocked'}})}>{draft.concept?.status==='running'&&<option value="running">正在执行（修改后重新规划）</option>}<option value="pending">待实现</option><option value="paused">暂停执行</option><option value="blocked">阻塞，待确认</option></select></label><fieldset><legend>前置任务</legend>{board.notes.filter(n=>n.kind==='concept'&&n.id!==note.id).map(n=><label className="lab-checkbox" key={n.id}><input type="checkbox" checked={draft.concept?.dependsOn.includes(n.id)||false} onChange={e=>patch({concept:{...draft.concept!,dependsOn:e.target.checked?[...(draft.concept?.dependsOn||[]),n.id]:(draft.concept?.dependsOn||[]).filter(id=>id!==n.id)}})}/>{n.title} · {conceptLabels[n.concept!.status]}</label>)}</fieldset></>}
      <h3>公开方案预览</h3><RichPreview note={{...draft,kind:'markdown'}}/>
      {note.concept?.progress&&<><h3>最近进展</h3><p>{note.concept.progress}</p></>}
      {note.concept?.evidence&&<><h3>产物与验证证据</h3><RichPreview note={{...note,kind:'markdown',body:note.concept.evidence}}/></>}
      <h3>修改与执行记录</h3><ol className="concept-history">{[...(note.concept?.history||[])].reverse().map((event,i)=><li key={i}><time>{new Date(event.at).toLocaleString()}</time>{event.text}</li>)}</ol>
      {locked&&<button className="secondary-button" onClick={()=>{onSave({concept:{...note.concept!,status:'pending',lease:undefined,history:[...(note.concept?.history||[]),{at:Date.now(),text:'用户重新打开已实现任务，原验证结果保留。'}].slice(-200)}})}}>重新打开，继续实现</button>}
      </>}</Suspense>
      {error&&<p role="alert" className="lab-error">{error}</p>}
    </div><footer className="workbench-editor-footer"><span>{busy?'运行或调试中，完成或停止后可保存。':destination==='项目'?'保存到当前 Agent 项目。':'保存后可继续在画布中连接和整理。'}</span><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy||locked} onClick={save}><Check size={15}/>保存笔记</button></footer></section></div>
}
export function AgentWorkboard({board,onOpen,onCreate}:{board:Board;onOpen:(note:CanvasNote)=>void;onCreate:()=>void}){
  const [,setTick]=useState(0)
  const now=Date.now()
  // Timer updates only the view; agent activity comes from actual protocol heartbeats.
  useEffect(()=>{const timer=setInterval(()=>setTick(value=>value+1),10000);return()=>clearInterval(timer)},[])
  const notes=board.notes.filter(n=>n.kind==='concept')
  return <section className="agent-workboard work-view" aria-label="Agent 构想与执行"><div className="work-view-title"><div><span className="section-overline">NEXT TO DO FOR AGENT</span><h2>构想、进展与结果，在同一处。</h2><p>编辑待实现笔记，Agent 检查后按新版本执行。已发生的动作需要 Agent 在后续步骤中处理。</p></div><button className="primary-button" onClick={onCreate}>添加构想</button></div>
    <div className="agent-presences">{(board.agents||[]).map(agent=><article key={agent.id}><span className={agentOnline(agent,now)?'presence-online':'presence-offline'}/><strong>{agent.name}</strong><span>{agentOnline(agent,now)?'最近 75 秒内有心跳':'未收到近期心跳'}</span><small>{board.notes.find(n=>n.id===agent.currentNoteId)?.title||'等待下一项'} · {new Date(agent.lastSeenAt).toLocaleTimeString()}</small><p>{agent.summary}</p></article>)}{!board.agents?.length&&<p>尚无 Agent 上报。通过“连接 Agent”配置 MCP，再让 Agent 调用 own_publish_plan 或 own_agent_next。</p>}<button onClick={()=>setTick(value=>value+1)}>刷新心跳显示</button></div>
    <div className="concept-columns">{(['pending','running','done','blocked','paused']as const).map(status=><section key={status} aria-label={conceptLabels[status]}><h3>{conceptLabels[status]} <span>{notes.filter(n=>n.concept?.status===status).length}</span></h3>{notes.filter(n=>n.concept?.status===status).map(note=><button className="concept-tile" key={note.id} onClick={()=>onOpen(note)}><strong>{note.title}</strong><p>{note.body?.slice(0,180)}</p><small>{status==='pending'?(board.agentBrief?.paused?'项目暂停':conceptReady(note,board.notes)?'可以领取':'等待前置任务'):note.concept?.agentId||'未分配'}</small>{note.concept?.progress&&<p>{note.concept.progress.slice(0,200)}</p>}{note.concept?.nextAction&&<p><strong>下一步：</strong>{note.concept.nextAction}</p>}{!!note.concept?.blockers?.length&&<p><strong>阻塞：</strong>{note.concept.blockers.join('；')}</p>}{note.concept?.lease&&note.concept.lease.expiresAt<now&&<em>执行凭证已过期，等待重新领取</em>}</button>)}</section>)}</div>
  </section>
}
