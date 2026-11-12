export const defaultAgentBrief={goal:'',scope:'',constraints:'',acceptance:'',paused:false,allowCode:true,allowMedia:true}
export function editAgentBrief(project,patch){
  const brief={...defaultAgentBrief,goal:project.description||'',...project.agentBrief,...patch}
  if(JSON.stringify(brief)===JSON.stringify({...defaultAgentBrief,goal:project.description||'',...project.agentBrief}))return project
  return {...project,agentBrief:brief,notes:project.notes.map(note=>note.concept?.lease?{...note,concept:{...note.concept,lease:undefined,...(note.concept.status==='running'?{status:'pending'}:{}),history:[...(note.concept.history||[]),{at:Date.now(),text:'用户修改项目目标、范围或约束，旧执行凭证已撤销。'}].slice(-200)}}:note)}
}
export function validAgentBrief(value){
  return !!value&&['goal','scope','constraints','acceptance'].every(k=>typeof value[k]==='string'&&value[k].length<=12000)&&['paused','allowCode','allowMedia'].every(k=>typeof value[k]==='boolean')
}
