export const conceptSpec = note => ({ id:note.id, title:note.title||'', body:note.body||'', acceptance:note.concept?.acceptance||'', dependsOn:note.concept?.dependsOn||[], planId:note.concept?.planId||'' })
export function dependenciesDone(note, notes) {
  return (note.concept?.dependsOn || []).every(id => notes.some(n => n.id === id && n.concept?.status === 'done'))
}
export function conceptReady(note, notes) {
  return note.kind === 'concept' && note.concept?.status === 'pending' &&
    dependenciesDone(note, notes)
}
export const agentOnline = (agent, now = Date.now()) => agent.lastSeenAt > 0 && now >= agent.lastSeenAt && now - agent.lastSeenAt < 75000
export function conceptDependencyError(notes) {
  const tasks=new Map(notes.filter(n=>n.kind==='concept').map(n=>[n.id,n]))
  const visiting=new Set(),visited=new Set()
  function visit(id) {
    if(visiting.has(id))return true
    if(visited.has(id)||!tasks.has(id))return false
    visiting.add(id)
    for(const dependency of tasks.get(id).concept?.dependsOn||[])if(visit(dependency))return true
    visiting.delete(id);visited.add(id)
    return false
  }
  return [...tasks.keys()].some(visit)?'前置任务存在循环依赖，请取消其中一项依赖。':''
}
export function restoreAgentActivity(board) {
  return {...board,agents:[],notes:board.notes.map(note=>note.concept?{...note,concept:{...note.concept,lease:undefined,...(note.concept.status==='running'?{status:'pending'}:{}),history:[...(note.concept.history||[]),{at:Date.now(),text:'从备份恢复，执行凭证已撤销，等待 Agent 重新领取。'}].slice(-200)}}:note)}
}
export function validConcept(value) {
  const str=(v,max)=>typeof v==='string'&&v.length<=max
  return !!value && str(value.planId,128) && ['pending','running','done','blocked','paused'].includes(value.status) &&
    str(value.acceptance,12000) && Array.isArray(value.dependsOn) && value.dependsOn.length<=100 && new Set(value.dependsOn).size===value.dependsOn.length && value.dependsOn.every(v=>str(v,128)&&v.length>0) &&
    ['progress','evidence'].every(k=>value[k]===undefined||str(value[k],50000)) &&
    (value.agentId===undefined||str(value.agentId,128)) &&
    (value.lease===undefined||value.lease&&str(value.lease.token,128)&&str(value.lease.revision,64)&&Number.isFinite(value.lease.expiresAt)) &&
    (value.history===undefined||Array.isArray(value.history)&&value.history.length<=200&&value.history.every(e=>e&&Number.isFinite(e.at)&&str(e.text,4000)))
}
