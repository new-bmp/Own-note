import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { conceptSpec, conceptReady, agentOnline, dependenciesDone } from '../shared/concepts.js'
import { placeCards } from './conversations.mjs'
import { projectBrief, projectRevision, checkLease, publicNote } from './project-policy.mjs'
const id=z.string().min(1).max(128), text=z.string().min(1).max(50000)
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const conceptRevision = note => hash(conceptSpec(note))
const log=(note,text)=>{ note.concept.history=[...(note.concept.history||[]),{at:Date.now(),text:text.slice(0,4000)}].slice(-200) }
export function registerAgentTools({tool,readWorkspace,mutateWorkspace,getBoard,boardUrl}) {
  const write={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  const target={projectId:id.optional().describe('独立 Agent 项目的 projectId。'),boardId:id.optional().describe('旧版兼容字段，优先使用 projectId。')}
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
  tool('own_list_agent_projects','查找独立 Agent 项目','列出 Next to do 独立模式中的项目、任务数量和打开链接。它们与自由画布分别保存。发布构想前先确定 projectId。',{query:z.string().max(200).optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(20)},read,async args=>{
    const {notebook}=await readWorkspace()
    const projects=(notebook?.agentProjects||[]).filter(p=>!p.trashed&&(!args.query||`${p.title} ${p.description}`.toLowerCase().includes(args.query.toLowerCase()))).map(p=>({projectId:p.id,title:p.title,description:p.description,taskCount:p.notes.filter(n=>n.kind==='concept').length,projectUrl:projectUrl(p.id),paused:projectBrief(p).paused}))
    return {projects:projects.slice(args.offset,args.offset+args.limit),total:projects.length,nextOffset:args.offset+args.limit<projects.length?args.offset+args.limit:null}
  })
  tool('own_create_agent_project','创建独立 Agent 项目','在独立 Next to do 模式创建项目，包含公开方案、执行任务和结果笔记。不会创建画布。requestId 用于防止重复创建。',{requestId:id,title:z.string().min(1).max(200),description:z.string().max(4000).default(''),goal:z.string().max(12000).default(''),scope:z.string().max(12000).default(''),constraints:z.string().max(12000).default(''),acceptance:z.string().max(12000).default('')},write,async args=>mutateWorkspace(notebook=>{
    if(!notebook){const canvas={...newProject('我的画布'),id:randomUUID()};notebook={version:1,workspaceVersion:1,boards:[canvas],activeBoardId:canvas.id}}
    notebook.agentProjects??=[]
    let project=notebook.agentProjects.find(p=>p.requestId===args.requestId)
    const duplicate=!!project
    if(project?.creationHash&&project.creationHash!==hash(args))throw new Error('requestId 已用于不同的项目内容，请为新项目使用新 ID。')
    if(!project){if(notebook.agentProjects.length>=1000)throw new Error('Agent 项目已达到 1000 个上限。');project={...newProject(args.title,args.description),requestId:args.requestId,creationHash:hash(args),agentBrief:{goal:args.goal||args.description,scope:args.scope,constraints:args.constraints,acceptance:args.acceptance,paused:false,allowCode:true,allowMedia:true}};notebook.agentProjects.push(project);notebook.activeAgentProjectId??=project.id}
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
      if(c.lease.projectRevision!==projectRevision(board)||projectBrief(board).paused||c.lease.revision!==conceptRevision(note)||c.status!=='running'||c.lease.expiresAt<Date.now()||!dependenciesDone(note,board.notes)) {
        const changed=c.lease.revision!==conceptRevision(note)
        if(c.status==='running') c.status='pending'
        delete c.lease
        log(note,changed?'用户修改了构想，旧执行凭证失效，等待 Agent 重新读取。':'执行凭证已过期或任务状态改变，等待重新领取。')
      }
    }
  }
  const describe=note=>({...publicNote(note),revision:conceptRevision(note)})
  tool('own_publish_plan','发布构想与待办笔记','向用户指定的独立 Agent 项目发布完整公开方案、任务说明、验收标准和依赖，使用 projectId。不要提交隐藏推理。任务按可编辑笔记展示，Agent 后续必须使用 own_agent_next / own_agent_report 执行。重复 requestId 不覆盖用户修改。兼容旧 boardId 并迁移到独立项目。',{
    ...target,requestId:id,agentId:id,agentName:id.optional(),title:z.string().min(1).max(200),markdown:text,
    tasks:z.array(z.object({id,title:z.string().min(1).max(200),markdown:text,acceptance:z.string().min(1).max(12000),dependsOn:z.array(id).max(100).default([])}).strict()).min(1).max(100),
  },write,async args=>mutateWorkspace(notebook=>{
    const board=getProject(notebook,args,true),planId=args.requestId
    if(projectBrief(board).paused)throw new Error('项目已整体暂停，请等待用户恢复后再发布任务。')
    const previous=board.notes.filter(n=>n.concept?.planId===planId)
    const previousPlan=board.notes.find(n=>n.source?.section==='agent-plan'&&n.source.requestId===planId)
    if(previousPlan?.source.fingerprint&&previousPlan.source.fingerprint!==hash(args))throw new Error('requestId 已用于不同方案，请为新一批任务使用新的 ID。')
    if(previous.length||previousPlan)return {notebook,unchanged:true,result:{projectId:board.id,overviewId:previousPlan?.id,duplicate:true,tasks:previous.map(describe),nextStep:'own_agent_next'}}
    const ids=new Map(args.tasks.map(t=>[t.id,randomUUID()]))
    if(ids.size!==args.tasks.length||args.tasks.some(t=>t.dependsOn.some(d=>!ids.has(d)||d===t.id)))throw new Error('任务 ID 重复，或依赖指向不存在的任务。')
    const visiting=new Set(),visited=new Set(),map=new Map(args.tasks.map(t=>[t.id,t]))
    function visit(id){if(visiting.has(id))throw new Error('任务依赖存在环，请拆开循环依赖。');if(visited.has(id))return;visiting.add(id);for(const d of map.get(id).dependsOn)visit(d);visiting.delete(id);visited.add(id)}
    args.tasks.forEach(t=>visit(t.id))
    const overview={id:randomUUID(),kind:'markdown',title:args.title,body:args.markdown,width:500,height:420,x:0,y:0,label:'Agent 公开构想',source:{requestId:planId,section:'agent-plan',fingerprint:hash(args),createdAt:new Date().toISOString(),agent:args.agentName||args.agentId}}
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
    if(projectBrief(board).paused){agent.currentNoteId=undefined;return {notebook,result:{status:'paused',projectId:board.id,brief:projectBrief(board),projectRevision:projectRevision(board),instruction:'用户已暂停整个项目。停止执行并在当前会话说明已有进展，等待用户恢复。'}}}
    const available=board.notes.filter(n=>n.kind==='concept'&&(!args.planId||n.concept.planId===args.planId))
    let note=available.find(n=>n.concept.status==='running'&&n.concept.agentId===args.agentId)
    note??=available.find(n=>conceptReady(n,board.notes))
    if(!note){agent.currentNoteId=undefined;return {notebook,result:{status:'waiting',tasks:available.map(describe),instruction:'等待用户修改或前置任务完成。此工具不会安排客户端自动继续，请在当前会话中按需检查。'}}}
    const c=note.concept
    if(c.status==='pending'){c.status='running';c.agentId=args.agentId;c.lease={token:randomUUID(),revision:conceptRevision(note),projectRevision:projectRevision(board),expiresAt:Date.now()+120000};log(note,`${agent.name} 领取任务。`)}
    else c.lease.expiresAt=Date.now()+120000
    agent.currentNoteId=note.id
    return {notebook,result:{status:'running',note:describe(note),leaseToken:c.lease.token,revision:c.lease.revision,heartbeatSeconds:30,projectId:board.id,brief:projectBrief(board),projectRevision:projectRevision(board),resume:note.concept.checkpointId?{checkpointId:note.concept.checkpointId,nextAction:note.concept.nextAction,blockers:note.concept.blockers,artifactIds:note.concept.artifactIds}:null,instruction:'只执行此版本。关键操作前及至少每 30 秒调用 own_agent_report；needsReplan=true 时停止使用旧方案。'}}
  }))
  tool('own_agent_report','报告进展并检查用户修改','续期执行凭证，报告进展、阻塞或已验证结果。每 30 秒及关键操作前调用。用户修改未实现笔记会撤销旧凭证；无法撤回已经发生的外部动作。完成需给出证据及测试结果。',{
    ...target,agentId:id,noteId:id,leaseToken:id,revision:z.string().length(64),status:z.enum(['running','done','blocked']),progress:z.string().max(12000).default(''),evidence:z.string().max(50000).optional(),nextAction:z.string().max(4000).optional(),blockers:z.array(z.string().max(2000)).max(100).optional(),artifactIds:z.array(id).max(100).optional(),
  },write,async args=>mutateWorkspace(notebook=>{
    const board=getProject(notebook,args),note=board.notes.find(n=>n.id===args.noteId&&n.kind==='concept')
    if(!note)return {notebook,unchanged:true,result:{accepted:false,needsReplan:true,instruction:'构想笔记已删除。停止旧方案，调用 own_agent_next 重新领取。'}}
    const agent=presence(board,args),c=note.concept
    const valid=!projectBrief(board).paused&&c.lease?.projectRevision===projectRevision(board)&&c.status==='running'&&c.agentId===args.agentId&&c.lease?.token===args.leaseToken&&c.lease.expiresAt>Date.now()&&args.revision===conceptRevision(note)&&args.revision===c.lease.revision&&dependenciesDone(note,board.notes)
    if(!valid){refresh(board);agent.currentNoteId=undefined;return {notebook,result:{accepted:false,needsReplan:true,note:describe(note),instruction:'用户已修改、暂停或重新分配此构想。停止旧方案，调用 own_agent_next 重新读取；不要覆盖用户笔记。'}}}
    if(args.status==='done'&&!args.evidence?.trim())throw new Error('完成任务需提供 evidence：实际产物、测试结果和限制。')
    if(args.artifactIds?.some(id=>!board.notes.some(n=>n.id===id)))throw new Error('artifactIds 包含不存在的项目笔记。')
    if(args.progress&&args.progress!==c.progress)log(note,`${agent.name}：${args.progress}`)
    c.progress=args.progress;for(const key of ['nextAction','blockers','artifactIds'])if(args[key]!==undefined)c[key]=args[key];c.status=args.status;c.lease.expiresAt=Date.now()+120000
    if(args.status!=='running'){c.evidence=args.evidence||'';delete c.lease;agent.currentNoteId=undefined;log(note,`${agent.name} ${args.status==='done'?'提交已验证结果':'报告阻塞'}：${args.progress}`)}
    agent.summary=args.progress;board.updatedAt=Date.now()
    return {notebook,result:{accepted:true,needsReplan:false,note:describe(note),nextStep:args.status==='running'?'own_agent_report':'own_agent_next'}}
  }))

  tool('own_read_agent_project','读取长期 Agent 工作上下文','恢复长期任务前先读取：完整目标、范围、约束、暂停状态、当前任务、公开方案目录、最近工作记录及分页任务。不会领取任务或续期；执行仍须 own_agent_next。',{...target,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(20)},read,async args=>{
    const {notebook}=await readWorkspace(),project=getProject(notebook,args),tasks=project.notes.filter(n=>n.kind==='concept')
    return {projectId:project.id,title:project.title,projectUrl:projectUrl(project.id),brief:projectBrief(project),projectRevision:projectRevision(project),counts:Object.fromEntries(['pending','running','done','blocked','paused'].map(status=>[status,tasks.filter(n=>n.concept.status===status).length])),agents:(project.agents||[]).map(a=>({...a,online:agentOnline(a)})),tasks:tasks.slice(args.offset,args.offset+args.limit).map(describe),total:tasks.length,nextOffset:args.offset+args.limit<tasks.length?args.offset+args.limit:null,contextNotes:project.notes.filter(n=>['agent-plan','agent-checkpoint'].includes(n.source?.section)).map(n=>({id:n.id,title:n.title,section:n.source.section,createdAt:n.source.createdAt,contentHash:hash(n)})).slice(-100),nextStep:{tool:'own_agent_next',arguments:{projectId:project.id,agentId:'当前 Agent 的稳定 ID'}},limits:'项目文字约束由协作 Agent 遵守；Own 在自身执行工具中强制检查暂停、执行开关和凭证，不能撤回其他客户端已发生的外部动作。'}
  })
  tool('own_agent_checkpoint','保存可恢复的工作记录','长期工作、切换会话或交接前保存完整公开记录：已完成内容、决定与依据、尚未完成、下一步、验证结果和笔记引用。必须携带有效任务凭证。requestId 保证重复调用不重复写入；新的会话先 read_agent_project 再读取 checkpoint。',{...target,requestId:id,agentId:id,taskId:id,leaseToken:id,revision:z.string().length(64),title:z.string().min(1).max(200),markdown:z.string().min(1).max(200000),nextAction:z.string().max(4000),blockers:z.array(z.string().max(2000)).max(100).default([]),artifactIds:z.array(id).max(100).default([])},write,async args=>mutateWorkspace(notebook=>{
    const project=getProject(notebook,args),previous=project.notes.find(n=>n.source?.section==='agent-checkpoint'&&n.source.requestId===args.requestId)
    if(previous){if(previous.source.fingerprint!==hash(args))throw new Error('requestId 已用于不同的工作记录。');return {notebook,unchanged:true,result:{noteId:previous.id,duplicate:true,contentHash:hash(previous)}}}
    const task=checkLease(project,args)
    if(args.artifactIds.some(id=>!project.notes.some(n=>n.id===id)))throw new Error('artifactIds 必须引用当前项目已保存的笔记。')
    const note={id:randomUUID(),kind:'markdown',title:args.title,body:args.markdown,width:560,height:420,x:0,y:0,source:{requestId:args.requestId,section:'agent-checkpoint',fingerprint:hash(args),agent:args.agentId,createdAt:new Date().toISOString()}}
    placeCards(project,[note]);Object.assign(task.concept,{checkpointId:note.id,nextAction:args.nextAction,blockers:args.blockers,artifactIds:args.artifactIds});log(task,'保存工作记录：'+args.title);project.updatedAt=Date.now()
    return {notebook,result:{noteId:note.id,duplicate:false,contentHash:hash(note),url:boardUrl(project.id,note.id),nextStep:{tool:'own_read_note',arguments:{projectId:project.id,noteId:note.id}}}}
  }))
  tool('own_agent_status','读取 Agent 与构想状态','读取独立项目的实际心跳、任务、修改历史、公开方案与结果。仅注册 MCP 配置不代表 Agent 已连接；online 根据最近 75 秒内心跳计算。', target,read,async args=>{
    const {notebook}=await readWorkspace(),board=getProject(notebook,args)
    return {agents:(board.agents||[]).map(a=>({...a,online:agentOnline(a)})),tasks:board.notes.filter(n=>n.kind==='concept').map(describe)}
  })
}
