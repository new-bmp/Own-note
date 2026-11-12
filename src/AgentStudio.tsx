import { useState } from 'react'
import { Bot, FileText, History, Plus, Code2 } from 'lucide-react'
import type { Board, CanvasNote } from './model'
import { AgentWorkboard, WorkbenchCard, isWorkbenchNote } from './Workbench'
import { RichPreview } from './RichContent'

export function AgentStudio({project,onNew,onUpdate,onCreate,onOpen,onConnect}:{project?:Board;onNew:()=>void;onUpdate:(patch:Partial<Board>)=>void;onCreate:()=>void;onOpen:(note:CanvasNote)=>void;onConnect:()=>void}){
  const [tab,setTab]=useState<'tasks'|'plans'|'history'|'materials'>('tasks')
  if(!project)return <div className="agent-studio agent-empty"><Bot size={42}/><h1>Next to do for agent</h1><p>建立独立项目，把公开方案、下一步任务、进展和验证结果保存在这里。</p><button className="primary-button" onClick={onNew}><Plus size={16}/>创建 Agent 项目</button><button className="secondary-button" onClick={onConnect}>连接 Agent</button></div>
  const plans=project.notes.filter(note=>note.source?.section==='agent-plan'||note.kind==='markdown')
  const materials=project.notes.filter(note=>note.kind!=='concept'&&!plans.includes(note))
  const history=project.notes.flatMap(note=>(note.concept?.history||[]).map(event=>({...event,note}))).sort((a,b)=>b.at-a.at)
  return <div className="agent-studio">
    <header className="agent-project-header"><div><span className="section-overline">NEXT TO DO FOR AGENT</span><input key={project.id+project.title+'title'} aria-label="Agent 项目名称" defaultValue={project.title} maxLength={200} onBlur={e=>{if(e.target.value.trim()&&e.target.value!==project.title)onUpdate({title:e.target.value.trim()})}}/><input key={project.id+project.description+'description'} aria-label="Agent 项目说明" placeholder="这个项目要实现什么？" defaultValue={project.description} maxLength={4000} onBlur={e=>{if(e.target.value!==project.description)onUpdate({description:e.target.value})}}/></div><button className="secondary-button" onClick={onConnect}><Bot size={16}/>连接 Agent</button></header>
    <nav className="analysis-tabs" aria-label="Agent 项目视图"><button aria-pressed={tab==='tasks'} onClick={()=>setTab('tasks')}><Bot size={16}/>待办与进展</button><button aria-pressed={tab==='plans'} onClick={()=>setTab('plans')}><FileText size={16}/>公开方案 {plans.length}</button><button aria-pressed={tab==='history'} onClick={()=>setTab('history')}><History size={16}/>执行记录</button><button aria-pressed={tab==='materials'} onClick={()=>setTab('materials')}><Code2 size={16}/>代码与资料 {materials.length}</button></nav>
    {tab==='tasks'?<AgentWorkboard board={project} onOpen={onOpen} onCreate={onCreate}/>:tab==='plans'?<div className="agent-plan-notes">{plans.map(note=><article key={note.id}><header><h2>{note.title}</h2><button onClick={()=>onOpen(note)}>编辑方案笔记</button></header><RichPreview note={note}/></article>)}{!plans.length&&<p className="analysis-empty">尚无公开方案。让 Agent 使用 own_publish_plan 发布，任务与验收标准会同步出现。</p>}</div>:tab==='materials'?<div className="agent-plan-notes">{materials.map(note=><article key={note.id}>{isWorkbenchNote(note)?<WorkbenchCard note={note} onOpen={()=>onOpen(note)}/>:<><header><h2>{note.title||note.filename}</h2><button onClick={()=>onOpen(note)}>打开笔记</button></header><RichPreview note={note}/></>}</article>)}{!materials.length&&<p>Agent 保存的代码、数据、公式和图表会出现在这里。</p>}</div>:<ol className="agent-activity-list">{history.map((event,i)=><li key={i}><time>{new Date(event.at).toLocaleString()}</time><button onClick={()=>onOpen(event.note)}>{event.note.title}</button><p>{event.text}</p></li>)}{!history.length&&<p>任务领取、修改要求及提交结果后，记录会出现在这里。</p>}</ol>}
  </div>
}
