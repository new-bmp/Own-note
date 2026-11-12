import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { conceptSpec, conceptReady, agentOnline, dependenciesDone } from '../shared/concepts.js'
import { placeCards } from './conversations.mjs'
const id=z.string().min(1).max(128), text=z.string().min(1).max(50000)
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const conceptRevision = note => hash(conceptSpec(note))
const log=(note,text)=>{ note.concept.history=[...(note.concept.history||[]),{at:Date.now(),text:text.slice(0,4000)}].slice(-200) }
export function registerAgentTools({tool,readWorkspace,mutateWorkspace,getBoard,boardUrl}) {
  const write={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  const target={projectId:id.optional(),boardId:id.optional()}
  const projectUrl=projectId=>boardUrl(projectId)
  const newProject=(title,description='')=>({id:'agent-'+randomUUID(),title,description,icon:'project',favorite:false,updatedAt:Date.now(),notes:[],connections:[],agents:[]})
  function getProject(notebook,args,create=false){
    if(!notebook)throw new Error('请先调用 own_create_agent_project 创建独立项目。')
    const projectId=args.projectId||args.boardId
    let project=notebook.agentProjects?.find(p=>!p.trashed&&(p.id===projectId||p.legacyBoardId===projectId))
    if(!project&&create&&args.boardId){const legacy=getBoard(notebook,args.boardId);project={...newProject(legacy.title+' · Agent',legacy.description),legacyBoardId:legacy.id};notebook.agentProjects??=[];notebook.agentProjects.push(project)}
    if(!project)throw new Error('Agent 项目不存在。请用 own_list_agent_projects 查找项目，或 own_create_agent_project 创建；使用 projectId。')
    return project
  }
  tool('own_list_agent_projects','查找独立 Agent 项目','列出 Next to do 独立模式中的项目、任务数量和打开链接。它们与自由画布分别保存。发布构想前先确定 projectId。',{query:z.string().max(200).optional()},read,async args=>{
    const {notebook}=await readWorkspace()
    return {projects:(notebook?.agentProjects||[]).filter(p=>!p.trashed&&(!args.query||`${p.title} ${p.description}`.toLowerCase().includes(args.query.toLowerCase()))).map(p=>({projectId:p.id,title:p.title,description:p.description,taskCount:p.notes.filter(n=>n.kind==='concept').length,projectUrl:projectUrl(p.id)}))}
  })
  tool('own_create_agent_project','创建独立 Agent 项目','在独立 Next to do 模式创建项目，包含公开方案、执行任务和结果笔记。不会创建画布。requestId 用于防止重复创建。',{requestId:id,title:z.string().min(1).max(200),description:z.string().max(4000).default('')},write,async args=>mutateWorkspace(notebook=>{
    if(!notebook){const canvas={...newProject('我的画布'),id:randomUUID()};notebook={version:1,workspaceVersion:1,boards:[canvas],activeBoardId:canvas.id}}
    notebook.agentProjects??=[]
    let project=notebook.agentProjects.find(p=>p.requestId===args.requestId)
    const duplicate=!!project
    if(!project){if(notebook.agentProjects.length>=1000)throw new Error('Agent 项目已达到 1000 个上限。');project={...newProject(args.title,args.description),requestId:args.requestId};notebook.agentProjects.push(project);notebook.activeAgentProjectId??=project.id}
    return {notebook,unchanged:duplicate,result:{projectId:project.id,title:project.title,projectUrl:projectUrl(project.id),duplicate,nextStep:'own_publish_plan'}}
  }))
  function presence(board, args) {
    board.agents??=[]
    let agent=board.agents.find(a=>a.id===args.agentId)
    if(!agent){if(board.agents.length>=100)throw new Error('最多 100 个 Agent 记录。');agent={id:args.agentId,name:args.agentName||args.agentId,lastSeenAt:Date.now()};board.agents.push(agent)}
    agent.lastSeenAt=Date.now();if(args.agentName)agent.name=args.agentName
    return agent
  }
  function refresh(board) {
    for(const note of board.notes.filter(n=>n.kind==='concept'&&n.concept?.lease)) {
      const c=note.concept
      if(c.lease.revision!==conceptRevision(note)||c.status!=='running'||c.lease.expiresAt<Date.now()||!dependenciesDone(note,board.notes)) {
        const changed=c.lease.revision!==conceptRevision(note)
        if(c.status==='running') c.status='pending'
        delete c.lease
        log(note,changed?'用户修改了构想，旧执行凭证失效，等待 Agent 重新读取。':'执行凭证已过期或任务状态改变，等待重新领取。')
      }
    }
  }
  const describe=note=>({...note,revision:conceptRevision(note),concept:{...note.concept,lease:note.concept.lease?{expiresAt:note.concept.lease.expiresAt}:undefined}})
  tool('own_publish_plan','发布构想与待办笔记','向用户指定的独立 Agent 项目发布完整公开方案、任务说明、验收标准和依赖，使用 projectId。不要提交隐藏推理。任务按可编辑笔记展示，Agent 后续必须使用 own_agent_next / own_agent_report 执行。重复 requestId 不覆盖用户修改。兼容旧 boardId 并迁移到独立项目。',{
    ...target,requestId:id,agentId:id,agentName:id.optional(),title:z.string().min(1).max(200),markdown:text,
    tasks:z.array(z.object({id,title:z.string().min(1).max(200),markdown:text,acceptance:z.string().min(1).max(12000),dependsOn:z.array(id).max(100).default([])}).strict()).min(1).max(100),
  },write,async args=>mutateWorkspace(notebook=>{
    const board=getProject(notebook,args,true),planId=args.requestId
    const previous=board.notes.filter(n=>n.concept?.planId===planId)
    if(previous.length||board.notes.some(n=>n.source?.section==='agent-plan'&&n.source.requestId===planId))return {notebook,unchanged:true,result:{duplicate:true,tasks:previous.map(describe),nextStep:'own_agent_next'}}
    const ids=new Map(args.tasks.map(t=>[t.id,randomUUID()]))
    if(ids.size!==args.tasks.length||args.tasks.some(t=>t.dependsOn.some(d=>!ids.has(d)||d===t.id)))throw new Error('任务 ID 重复，或依赖指向不存在的任务。')
    const visiting=new Set(),visited=new Set(),map=new Map(args.tasks.map(t=>[t.id,t]))
    function visit(id){if(visiting.has(id))throw new Error('任务依赖存在环，请拆开循环依赖。');if(visited.has(id))return;visiting.add(id);for(const d of map.get(id).dependsOn)visit(d);visiting.delete(id);visited.add(id)}
    args.tasks.forEach(t=>visit(t.id))
    const overview={id:randomUUID(),kind:'markdown',title:args.title,body:args.markdown,width:500,height:420,x:0,y:0,label:'Agent 公开构想',source:{requestId:planId,section:'agent-plan',createdAt:new Date().toISOString(),agent:args.agentName||args.agentId}}
    const notes=args.tasks.map(t=>({id:ids.get(t.id),kind:'concept',title:t.title,body:t.markdown,x:0,y:0,width:440,height:380,concept:{planId,status:'pending',acceptance:t.acceptance,dependsOn:t.dependsOn.map(d=>ids.get(d)),history:[{at:Date.now(),text:`${args.agentName||args.agentId} 发布任务。`}]}}))
    placeCards(board,[overview,...notes],true)
    board.connections.push(...notes.map(n=>({id:randomUUID(),from:overview.id,to:n.id,label:'待实现',style:'elbow'})))
    for(const n of notes)for(const from of n.concept.dependsOn)board.connections.push({id:randomUUID(),from,to:n.id,label:'完成后',style:'elbow'})
    presence(board,args);board.updatedAt=Date.now()
    return {notebook,result:{projectId:board.id,projectUrl:projectUrl(board.id),boardUrl:projectUrl(board.id),planId,overviewId:overview.id,tasks:notes.map(describe),nextStep:{tool:'own_agent_next',arguments:{projectId:board.id,agentId:args.agentId}},instruction:'领取前读取用户最新笔记。执行前、关键步骤后和每 30 秒调用 own_agent_report 检查修改；只有 evidence 描述真实验证后才能提交 done。'}}
  }))
  tool('own_agent_next','领取下一项最新构想','发送心跳并领取依赖已完成的待办；返回可执行笔记、验收标准、当前 revision 与 leaseToken。没有任务时明确等待，不伪造活动。用户暂停/修改、凭证过期均需重新读取。',{
    ...target,agentId:id,agentName:id.optional(),planId:id.optional(),
  },write,async args=>mutateWorkspace(notebook=>{
    const board=getProject(notebook,args);refresh(board);const agent=presence(board,args)
    const available=board.notes.filter(n=>n.kind==='concept'&&(!args.planId||n.concept.planId===args.planId))
    let note=available.find(n=>n.concept.status==='running'&&n.concept.agentId===args.agentId)
    note??=available.find(n=>conceptReady(n,board.notes))
    if(!note){agent.currentNoteId=undefined;return {notebook,result:{status:'waiting',tasks:available.map(describe),instruction:'等待用户修改或前置任务完成。此工具不会安排客户端自动继续，请在当前会话中按需检查。'}}}
    const c=note.concept
    if(c.status==='pending'){c.status='running';c.agentId=args.agentId;c.lease={token:randomUUID(),revision:conceptRevision(note),expiresAt:Date.now()+120000};log(note,`${agent.name} 领取任务。`)}
    else c.lease.expiresAt=Date.now()+120000
    agent.currentNoteId=note.id
    return {notebook,result:{status:'running',note:describe(note),leaseToken:c.lease.token,revision:c.lease.revision,heartbeatSeconds:30,instruction:'只执行此版本。关键操作前及至少每 30 秒调用 own_agent_report；needsReplan=true 时停止使用旧方案。'}}
  }))
  tool('own_agent_report','报告进展并检查用户修改','续期执行凭证，报告进展、阻塞或已验证结果。每 30 秒及关键操作前调用。用户修改未实现笔记会撤销旧凭证；无法撤回已经发生的外部动作。完成需给出证据及测试结果。',{
    ...target,agentId:id,noteId:id,leaseToken:id,revision:z.string().length(64),status:z.enum(['running','done','blocked']),progress:z.string().max(12000).default(''),evidence:z.string().max(50000).optional(),
  },write,async args=>mutateWorkspace(notebook=>{
    const board=getProject(notebook,args),note=board.notes.find(n=>n.id===args.noteId&&n.kind==='concept')
    if(!note)return {notebook,unchanged:true,result:{accepted:false,needsReplan:true,instruction:'构想笔记已删除。停止旧方案，调用 own_agent_next 重新领取。'}}
    const agent=presence(board,args),c=note.concept
    const valid=c.status==='running'&&c.agentId===args.agentId&&c.lease?.token===args.leaseToken&&c.lease.expiresAt>Date.now()&&args.revision===conceptRevision(note)&&args.revision===c.lease.revision&&dependenciesDone(note,board.notes)
    if(!valid){refresh(board);agent.currentNoteId=undefined;return {notebook,result:{accepted:false,needsReplan:true,note:describe(note),instruction:'用户已修改、暂停或重新分配此构想。停止旧方案，调用 own_agent_next 重新读取；不要覆盖用户笔记。'}}}
    if(args.status==='done'&&!args.evidence?.trim())throw new Error('完成任务需提供 evidence：实际产物、测试结果和限制。')
    c.progress=args.progress;c.status=args.status;c.lease.expiresAt=Date.now()+120000
    if(args.status!=='running'){c.evidence=args.evidence||'';delete c.lease;agent.currentNoteId=undefined;log(note,`${agent.name} ${args.status==='done'?'提交已验证结果':'报告阻塞'}：${args.progress}`)}
    agent.summary=args.progress;board.updatedAt=Date.now()
    return {notebook,result:{accepted:true,needsReplan:false,note:describe(note),nextStep:args.status==='running'?'own_agent_report':'own_agent_next'}}
  }))
  tool('own_agent_status','读取 Agent 与构想状态','读取独立项目的实际心跳、任务、修改历史、公开方案与结果。仅注册 MCP 配置不代表 Agent 已连接；online 根据最近 75 秒内心跳计算。', target,read,async args=>{
    const {notebook}=await readWorkspace(),board=getProject(notebook,args)
    return {agents:(board.agents||[]).map(a=>({...a,online:agentOnline(a)})),tasks:board.notes.filter(n=>n.kind==='concept').map(describe)}
  })
}
