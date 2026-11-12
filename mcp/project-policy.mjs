import { createHash } from 'node:crypto'
import { conceptSpec, dependenciesDone } from '../shared/concepts.js'

export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const projectBrief=project=>({goal:project.agentBrief?.goal??project.description??'',scope:project.agentBrief?.scope||'',constraints:project.agentBrief?.constraints||'',acceptance:project.agentBrief?.acceptance||'',paused:project.agentBrief?.paused||false,allowCode:project.agentBrief?.allowCode!==false,allowMedia:project.agentBrief?.allowMedia!==false})
export const projectRevision=project=>hash({brief:projectBrief(project),plans:project.notes.filter(n=>n.source?.section==='agent-plan').map(n=>({id:n.id,title:n.title,body:n.body}))})
export const taskRevision=note=>hash(conceptSpec(note))
export function publicNote(note){
  if(!note.concept?.lease)return note
  const {token,...lease}=note.concept.lease
  return {...note,concept:{...note.concept,lease}}
}
export function checkLease(project,args){
  const note=project.notes.find(n=>n.id===(args.taskId||args.noteId)&&n.kind==='concept'),lease=note?.concept?.lease
  if(projectBrief(project).paused)throw new Error('项目已整体暂停。请读取 own_read_agent_project，等待用户恢复。')
  if(!note||note.concept.status!=='running'||note.concept.agentId!==args.agentId||!lease||lease.token!==args.leaseToken||lease.expiresAt<=Date.now()||args.revision!==taskRevision(note)||lease.revision!==args.revision||lease.projectRevision!==projectRevision(project)||!dependenciesDone(note,project.notes))throw new Error('任务或项目约束已改变，执行凭证失效。停止旧方案，调用 own_agent_next 重新读取；不要覆盖用户修改。')
  return note
}
export function checkProjectAction(notebook,targetId,action,context){
  const project=notebook?.agentProjects?.find(p=>p.id===targetId&&!p.trashed)
  if(!project)return
  const brief=projectBrief(project)
  if(brief.paused)throw new Error('项目已整体暂停，禁止继续写入或执行。读取 own_read_agent_project 获取最新约束。')
  if(action==='code'&&!brief.allowCode||action==='media'&&!brief.allowMedia)throw new Error('用户已禁用此项目的'+(action==='code'?'代码执行':'媒体转换')+'。请先读取项目约束。')
  if(context)checkLease(project,context)
  else if(['code','media'].includes(action))throw new Error('Agent 项目执行需要 execution={taskId,agentId,leaseToken,revision}，请先 own_agent_next。')
}
