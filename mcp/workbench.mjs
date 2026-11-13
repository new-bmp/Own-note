import { z } from 'zod'
import { hash, checkProjectAction } from './project-policy.mjs'
import { parseDataset, summarize, filterRows, aggregate, numeric } from '../shared/data-analysis.js'
import { validChart } from '../shared/rich-content.js'
import { id, target, addBase, executionSchema, analysisSettingsSchema } from './schemas.mjs'

export function createMcpLab({jobs,debugging,readWorkspace,mutateWorkspace}){
  const runs=new Map(),requests=new Map(),latest=new Map(),inflight=new Map()
  let closed=false,updating=false
  const state=run=>run.kind==='debug'?debugging.get(run.id):jobs.get(run.id)
  const terminal=s=>!['starting','running','paused'].includes(s.status)
  function cancel(run){if(run.kind==='debug')void debugging.command(run.id,{action:'stop'}).catch(()=>{});else jobs.cancel(run.id)}
  function guard(notebook,run){
    if(!notebook)throw new Error('工作空间已不存在。')
    checkProjectAction(notebook,run.targetId,run.action,run.execution)
    const board=[...notebook.boards,...notebook.agentProjects||[]].find(b=>b.id===run.targetId&&!b.trashed)
    if(!board)throw new Error('目标已删除。')
    return board
  }
  async function sync(run){
    if(run.settled||run.discarded||run.saving)return
    run.saving=true
    try{
      const outcome=await mutateWorkspace(notebook=>{
        let board;try{board=guard(notebook,run)}catch(error){run.discarded=error.message;cancel(run);return {notebook,unchanged:true}}
        const current=state(run);if(!terminal(current))return {notebook,unchanged:true}
        if(!run.noteId)return {notebook,unchanged:true,result:'finished'}
        const note=board.notes.find(n=>n.id===run.noteId),cell=note?.cells?.find(c=>c.id===run.cellId)
        if(!cell||hash(cell)!==run.cellHash||latest.get(run.targetId+':'+run.cellId)!==run.id){run.discarded='代码单元已被用户修改或已有更新的运行，保留用户内容；结果可通过 jobId 读取。';return {notebook,unchanged:true}}
        Object.assign(cell,{output:current.stdout,error:[current.stderr,current.reason&&current.status!=='finished'&&current.status!=='success'?current.reason:''].filter(Boolean).join('\n'),exitCode:current.exitCode??1,executedCode:run.code,executedLanguage:run.language,executedInput:run.stdin,executedAt:Date.now(),executionCount:(cell.executionCount||0)+1})
        board.updatedAt=Date.now();return {notebook,result:'saved'}
      })
      if(outcome){run.settled=true;run.saved=outcome==='saved'}
    }catch(error){run.discarded=error.message}finally{run.saving=false}
  }
  async function get(runId){const run=runs.get(runId);if(!run)throw new Error('运行不属于当前 MCP 工作台或已过期。');await sync(run);return {...state(run),savedToNote:!!run.saved,resultNotice:run.discarded,noteId:run.noteId,cellId:run.cellId}}
  function start(args,kind){
    const key=kind+':'+(args.projectId||args.boardId)+':'+args.requestId,fingerprint=hash(args),pending=inflight.get(key)
    if(pending){if(pending.hash!==fingerprint)throw new Error('requestId 已用于不同的运行参数。');return pending.operation}
    const operation=launch(args,kind);inflight.set(key,{hash:fingerprint,operation})
    void operation.finally(()=>inflight.delete(key)).catch(()=>{})
    return operation
  }
  async function launch(args,kind){
    if(closed)throw new Error('服务正在关闭。')
    const requestKey=kind+':'+(args.projectId||args.boardId)+':'+args.requestId,previous=requests.get(requestKey)
    if(previous){if(previous.hash!==hash(args))throw new Error('requestId 已用于不同的运行参数。');return get(previous.id)}
    // Reserve durably before spawning: after a crash, an ambiguous operation
    // must be reviewed instead of silently running the same request again.
    await mutateWorkspace(notebook=>{
      const targetId=args.projectId||args.boardId
      checkProjectAction(notebook,targetId,kind==='media'?'media':'code',args.execution)
      const board=[...notebook?.boards||[],...notebook?.agentProjects||[]].find(b=>b.id===targetId&&!b.trashed)
      if(!board)throw new Error('执行目标不存在。')
      const previous=board.executionReceipts?.find(r=>r.requestId===args.requestId&&r.kind===kind)
      if(previous){if(previous.fingerprint!==hash(args))throw new Error('requestId 已用于不同的运行参数。');throw new Error('此执行请求已受理，但运行记录在服务重启后或清理后已不可用。先读取笔记和工作记录核查结果；只有确需再次执行时才使用新 requestId。')}
      if(kind!=='media'){
        const note=board.notes.find(n=>n.id===args.noteId)
        if(!['code','program'].includes(note?.kind)||!note.cells.some(c=>c.id===args.cellId)||hash(note)!==args.expectedHash)throw new Error('可运行单元不存在或笔记已修改，请先 own_read_note。')
      }
      board.executionReceipts=[...(board.executionReceipts||[]).slice(-999),{requestId:args.requestId,kind,fingerprint:hash(args),at:Date.now()}]
      return {notebook}
    })
    let run
    await mutateWorkspace(notebook=>{
      const previous=requests.get(requestKey)
      if(previous){if(previous.hash!==hash(args))throw new Error('requestId 已用于不同的运行参数。');run=runs.get(previous.id);return {notebook,unchanged:true}}
      if(runs.size>=100){const old=[...runs.values()].find(r=>r.settled||r.discarded);if(!old)throw new Error('工作台运行记录已达到上限。');runs.delete(old.id);for(const [key,v]of requests)if(v.id===old.id)requests.delete(key);if(latest.get(old.targetId+':'+old.cellId)===old.id)latest.delete(old.targetId+':'+old.cellId)}
      const targetId=args.projectId||args.boardId,action=kind==='media'?'media':'code'
      checkProjectAction(notebook,targetId,action,args.execution)
      const board=[...notebook.boards,...notebook.agentProjects||[]].find(b=>b.id===targetId&&!b.trashed)
      if(!board)throw new Error('目标不存在，请先查找画布或 Agent 项目。')
      if(kind==='media'){
        const note=board.notes.find(n=>n.id===args.noteId),assetId=args.path?note?.entries?.find(e=>e.path===args.path&&e.kind==='file')?.assetId:note?.assetId
        if(!assetId)throw new Error('笔记中未找到指定媒体附件。')
        const value=jobs.start('media',{assetId,type:args.type});run={id:value.id,kind,targetId,action,execution:args.execution}
      }else{
        const note=board.notes.find(n=>n.id===args.noteId),cell=note?.cells?.find(c=>c.id===args.cellId)
        if(!cell||!['code','program'].includes(note.kind))throw new Error('可运行单元不存在。先 own_read_note 获取 cells 和 contentHash。')
        if(hash(note)!==args.expectedHash)throw new Error('代码笔记已修改，请重新读取后运行。')
        const input={language:cell.language,code:cell.code,stdin:cell.stdin}
        const value=kind==='debug'?debugging.start({...input,breakpoints:args.breakpoints||[],watches:args.watches||[]}):jobs.start('code',input)
        run={id:value.id,kind,targetId,action,execution:args.execution,noteId:note.id,cellId:cell.id,cellHash:hash(cell),...input}
        latest.set(targetId+':'+cell.id,run.id)
      }
      runs.set(run.id,run);requests.set(requestKey,{id:run.id,hash:hash(args)})
      return {notebook,unchanged:true}
    })
    return get(run.id)
  }
  async function command(args){
    const run=runs.get(args.jobId);if(!run)throw new Error('运行记录已过期。')
    if(args.action==='stop'){cancel(run);return get(run.id)}
    if(run.kind!=='debug')throw new Error('此运行不是调试会话。')
    const {notebook}=await readWorkspace();try{guard(notebook,run)}catch(error){cancel(run);run.discarded=error.message;throw error}
    await debugging.command(run.id,args);return get(run.id)
  }
  async function reconcile(notebook){for(const run of runs.values()){if(run.settled||run.discarded)continue;try{guard(notebook,run)}catch(error){run.discarded=error.message;cancel(run)}}}
  const timer=setInterval(()=>{if(updating||closed)return;updating=true;void Promise.allSettled([...runs.values()].map(sync)).finally(()=>{updating=false})},300);timer.unref()
  async function mediaFile(args){const run=runs.get(args.jobId);if(run?.kind!=='media'||run.targetId!==(args.projectId||args.boardId))throw new Error('转换不属于指定目标。');const {notebook}=await readWorkspace();guard(notebook,{...run,execution:args.execution||run.execution});return jobs.artifact(run.id)}
  return {start,get,command,reconcile,mediaFile,close(){closed=true;clearInterval(timer);for(const run of runs.values())if(!run.settled)cancel(run)}}
}

function analyze(note,overrides){
  const data=parseDataset(note.analysisSource,note.analysisFormat),settings={...note.analysisSettings,...overrides},filter=settings.filter,sort=settings.sort
  for(const column of [settings.group,settings.value,filter?.column,sort?.column])if(column!==undefined&&(column<-1||column>=data.columns.length))throw new Error('数据列索引超出范围，先读取 columns。')
  const accepted=new Set(filter?filterRows(data.rows,filter.column,filter.operator,filter.value):data.rows)
  const indexed=data.rows.map((row,index)=>({row,index:index+1})).filter(v=>accepted.has(v.row))
  if(sort&&sort.column>=0)indexed.sort((a,b)=>{const av=numeric(a.row[sort.column]),bv=numeric(b.row[sort.column]);return (av!==undefined&&bv!==undefined?av-bv:a.row[sort.column].localeCompare(b.row[sort.column],'zh-CN',{numeric:true}))*(sort.ascending?1:-1)})
  const rows=indexed.map(v=>v.row),groups=settings.group!==undefined&&settings.value!==undefined?aggregate(rows,settings.group,settings.value,settings.method||'sum'):[]
  if(settings.order==='label')groups.sort((a,b)=>a.label.localeCompare(b.label,'zh-CN',{numeric:true}))
  if(!settings.order||settings.order==='source'){const order=new Map([...new Set(rows.map(r=>r[settings.group]||'（空）'))].map((label,index)=>[label,index]));groups.sort((a,b)=>order.get(a.label)-order.get(b.label))}
  return {data,settings,indexed,rows,groups}
}

export function registerWorkbenchTools({tool,lab,jobs,assets,readWorkspace,getBoard,append,makeCard,receipt,mutateWorkspace,readOnly,appendOnly}){
  tool('own_run_code','运行已保存的代码单元','执行指定代码笔记的一个单元，返回 jobId；调用 own_lab_result 读实时输出。使用随包工具链，最多 30 秒。结果仅在源码、输入和任务凭证仍有效时自动保存，用户修改不会被覆盖。项目执行须提供 execution。',{...target,requestId:id,noteId:id,cellId:id,expectedHash:z.string().length(64),execution:executionSchema.optional()}, {...appendOnly,destructiveHint:true,openWorldHint:true},args=>lab.start(args,'code'))
  tool('own_start_debug','开始真实单步调试','调试已保存单元，支持 JS/TS、Python、C/C++；先保存源码，再开始，使用 own_lab_result 查看状态与变量，own_debug_command 单步/断点/观察/调用栈。',{...target,requestId:id,noteId:id,cellId:id,expectedHash:z.string().length(64),execution:executionSchema.optional(),breakpoints:z.array(z.number().int().min(1).max(10000)).max(100).optional(),watches:z.array(z.string().min(1).max(500)).max(20).optional()},{...appendOnly,destructiveHint:true,openWorldHint:true},args=>lab.start(args,'debug'))
  tool('own_lab_result','读取运行与变量结果','读取 jobId 的状态、stdout/stderr、真实暂停行、局部变量、观察表达式、调用栈，以及结果是否已保存。轮询间隔建议 300ms–1s，不重复启动。', {jobId:id},readOnly,args=>lab.get(args.jobId))
  tool('own_debug_command','单步、断点和停止','next 下一步、step 进入、out 跳出、continue 继续、pause 暂停、frame 切换栈帧、configure 设置断点与观察、stop 停止（也可停止代码和媒体任务）。项目暂停或约束改变后拒绝继续执行。',{jobId:id,action:z.enum(['next','step','out','continue','pause','frame','configure','stop']),index:z.number().int().min(0).max(24).optional(),breakpoints:z.array(z.number().int().min(1).max(10000)).max(100).optional(),watches:z.array(z.string().min(1).max(500)).max(20).optional()}, {...appendOnly,idempotentHint:false,destructiveHint:true,openWorldHint:true},args=>lab.command(args))
  tool('own_convert_media','转换笔记中的媒体','对已保存文件或文件夹中的指定文件转换 MP3 或 MP4（H.264/AAC）；返回 jobId，通过 own_lab_result 读取结果 url。原文件保留，转换不代表所有编码一定可解码。',{...target,requestId:id,noteId:id,path:z.string().max(4000).optional(),type:z.enum(['audio','video']),execution:executionSchema.optional()},appendOnly,args=>lab.start(args,'media'))
  tool('own_save_media_result','保存媒体转换结果到笔记','将成功转换的 jobId 保存为永久附件笔记，保留原文件。转换缓存会过期，应在成功后保存；requestId 防止重复笔记。',{...addBase,jobId:id,filename:z.string().min(1).max(255).optional()},appendOnly,async args=>{
    const {notebook}=await readWorkspace(),board=getBoard(notebook,args.boardId),previous=board.notes.find(n=>n.source?.requestId===args.requestId)
    if(previous)return append(args,previous)
    const output=await lab.mediaFile(args),extension=output.mime==='audio/mpeg'?'.mp3':'.mp4',filename=(args.filename||args.title).replace(/\.[^.]+$/,'')+extension
    const asset=await assets.ingest(output.file,'derived-'+args.jobId,filename,output.mime)
    return append(args,makeCard('file',args.title,{assetId:asset.assetId,filename,mime:asset.mime,size:asset.size,caption:args.caption||'媒体转换结果'}))
  })
  tool('own_analyze_data','读取、筛选与分析数据','使用已保存分析笔记，返回列统计、分页数据、原始行号和分组聚合。与界面共用解析器。settings 可覆盖已保存设置，不修改源码。offset/limit 继续读取；数值空值不当 0。',{...target,noteId:id,settings:analysisSettingsSchema.optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(50)},readOnly,async args=>{
    const {notebook}=await readWorkspace(),board=getBoard(notebook,args.projectId||args.boardId),note=board.notes.find(n=>n.id===args.noteId)
    if(note?.kind!=='analysis')throw new Error('需要分析笔记，请先 own_add_analysis。')
    const {data,settings,indexed,rows,groups}=analyze(note,args.settings)
    return {contentHash:hash(note),settings,columns:data.columns,totalRows:data.rows.length,filteredRows:rows.length,rows:indexed.slice(args.offset,args.offset+args.limit),nextOffset:args.offset+args.limit<rows.length?args.offset+args.limit:null,statistics:summarize(data.columns,rows),groups:groups.slice(args.offset,args.offset+args.limit),totalGroups:groups.length,nextGroupOffset:args.offset+args.limit<groups.length?args.offset+args.limit:null}
  })
  tool('own_chart_from_analysis','从分析保存可追溯图表','从指定版本的分析原始数据直接筛选、聚合和制图，保留来源笔记 ID、hash、计算设置和行数。最多显示前60组，会明确说明；原数据不截断。',{...addBase,noteId:id,expectedHash:z.string().length(64),settings:analysisSettingsSchema.optional()},appendOnly,async args=>{
    const {notebook}=await readWorkspace(),board=getBoard(notebook,args.boardId),note=board.notes.find(n=>n.id===args.noteId)
    const previous=board.notes.find(n=>n.source?.requestId===args.requestId);if(previous)return append(args,previous)
    if(note?.kind!=='analysis'||hash(note)!==args.expectedHash)throw new Error('分析笔记不存在或已修改，请先 own_read_note。')
    const {data,settings,rows,groups}=analyze(note,args.settings)
    if(settings.group===undefined||settings.value===undefined)throw new Error('制图需要 settings.group 与 settings.value 列索引；先 own_analyze_data 读取列。')
    const chart={type:settings.chartType||'bar',labels:groups.slice(0,60).map(g=>g.label),series:[{name:settings.method==='count'?'记录数':data.columns[settings.value],values:groups.slice(0,60).map(g=>g.value)}]}
    if(!validChart(chart))throw new Error('聚合结果无法制图，检查空数据、标签长度、数值及饼图的非负约束。')
    const origin={noteId:note.id,contentHash:args.expectedHash,settings,rows:rows.length,totalGroups:groups.length},caption=[args.caption,`来源：${note.title}；${rows.length} 行，按 ${data.columns[settings.group]} 分组，${settings.method||'sum'}。`,groups.length>60?`共 ${groups.length} 组，显示前 60 组。`:''].filter(Boolean).join('\n')
    const value=await append(args,makeCard('chart',args.title,{chart,caption,analysisOrigin:origin}),(_,current)=>{const source=current.notes.find(n=>n.id===args.noteId);if(!source||hash(source)!==args.expectedHash)throw new Error('分析数据在保存图表前已修改，请重新分析。')})
    return {...value,origin,truncated:groups.length>60}
  })
}
