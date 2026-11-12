// Examples use placeholders only for values returned by a preceding call.
export const featureHelp={
  agent:{
    steps:['own_read_agent_project；分页读完任务，own_read_note 读方案和最近 checkpoint','own_agent_next 领取；遵守返回 brief；每30秒和关键动作前 own_agent_report','own_agent_checkpoint 留完整记录，done 附 evidence'],
    example:{tool:'own_agent_checkpoint',arguments:{projectId:'返回的 projectId',requestId:'handoff-001',taskId:'领取的 note.id',agentId:'当前 Agent 的稳定 ID',leaseToken:'领取返回的 leaseToken',revision:'领取返回的 revision',title:'本次工作与交接',markdown:'## 已完成\n实际产物与验证。\n## 依据\n公开决策与来源。\n## 未完成\n剩余问题与限制。',nextAction:'具体下一步',blockers:[],artifactIds:[]}},
    recovery:'needsReplan=true、凭证过期或约束修改：停止旧执行，重新 read_agent_project 和 agent_next。不要覆盖用户任务。',
  },
  code:{
    steps:['own_add_code 保存 cells，再 own_read_note 获取 note.id、cells[].id、contentHash','own_run_code 或 own_start_debug（项目中填 execution）','轮询 own_lab_result；调试用 own_debug_command；确认 savedToNote 或说明 resultNotice'],
    example:{tool:'own_debug_command',arguments:{jobId:'启动返回的 id',action:'configure',breakpoints:[3],watches:['total * 2']}},
    recovery:'编辑语言不一定可执行，先核对 runtime.languages/debugging。输入和源码必须先保存。相同 requestId 重试不重跑，源码hash冲突先重读。',
  },
  analysis:{
    steps:['own_add_analysis 保存原始数据','own_analyze_data 查看 columns、统计及原始行号；按 nextOffset / nextGroupOffset 读完','own_chart_from_analysis 以该 contentHash 保存实际聚合图表'],
    example:{tool:'own_chart_from_analysis',arguments:{projectId:'返回的 projectId',requestId:'analysis-chart-001',noteId:'分析笔记ID',expectedHash:'读取返回的64位contentHash',title:'按类别求和',settings:{group:0,value:1,method:'sum',order:'source',chartType:'bar',filter:{column:1,operator:'greater',value:'0'}}}},
    recovery:'列索引从0开始。hash冲突重读原始数据；空值不补0。超过60组只限制图表展示，原始数据和分页聚合仍完整。',
  },
  attachments:{
    steps:['own_upload_asset start → chunk（Base64，offset按字节）→ commit，保存返回的 assetId','own_add_attachment 保存 file/image/folder；entries[].path 使用安全相对路径','own_read_attachment 分页浏览或读原文件并核验SHA；模型资源全部放入同一folder','媒体用 own_convert_media → own_lab_result → own_save_media_result 保存永久附件'],
    example:{tool:'own_add_attachment',arguments:{boardId:'画布ID',requestId:'model-folder-001',title:'模型与资源',kind:'folder',entries:[{path:'scene/model.gltf',kind:'file',assetId:'主模型上传返回的assetId'},{path:'scene/model.bin',kind:'file',assetId:'缓冲文件上传返回的assetId'},{path:'empty',kind:'directory'}],modelPath:'scene/model.gltf',modelSettings:{wireframe:false,grid:true,autoRotate:false}}},
    recovery:'每块最多262144字节、单文件100MB。SHA错误不提交；乱序用返回nextOffset；分块重试内容须相同。模型不加载远程资源，媒体失败保留原文件。',
  },
  connections:{
    steps:['先取得同一画布/项目两张笔记的ID','own_connect_notes 创建关系','own_read_board.connections 取hash，own_update_connection 更新样式'],
    example:{tool:'own_connect_notes',arguments:{boardId:'画布ID',requestId:'relation-001',from:'笔记A的ID',to:'笔记B的ID',label:'验证依据',style:'elbow',arrow:'end',dashed:false,fromSide:'right',toSide:'left',color:'#5266d4'}},
    recovery:'连线不修改任务依赖。更新冲突重读connections，不覆盖用户的新样式。',
  },
  authoring:{
    steps:['own_add_note/latex/diagram/chart 保存正文、公式和图；长会话优先 own_save_conversation','own_read_note 或 own_read_conversation 读回核对','own_update_note 使用expectedHash修改内容、设置或布局'],
    example:{tool:'own_update_note',arguments:{boardId:'画布ID',noteId:'媒体笔记ID',expectedHash:'读取返回的64位contentHash',mediaSettings:{speed:1.5,volume:1,loop:false,start:0,marks:[{time:12,label:'关键说明'}]}}},
    recovery:'公式使用KaTeX源码，Mermaid不带代码围栏。错误后按返回提示修正；不要删除必要正文来通过长度限制，长会话分批追加。',
  },
}
