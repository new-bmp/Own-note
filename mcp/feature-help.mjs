// Examples use placeholders only for values returned by a preceding call.
export const featureHelp={
  canvas:{
    steps:['own_list_boards 定位上级画布；own_read_board 获取 path、childBoards 和完整内容','own_create_board 指定 parentBoardId 创建子画布，用返回 boardId 保存内容','所有层级共用附件；演讲模式在客户端全屏打开，临时布局不保存且内容只读'],
    example:{tool:'own_create_board',arguments:{parentBoardId:'上级画布ID',requestId:'report-detail-001',title:'报告详情',description:'展开报告依据与附件'}},
    recovery:'子画布只属于一个上级，禁止循环和悬空引用；入口删除保留子画布，可从侧边栏进入。被回收的画布需用户恢复。',
  },
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
  program:{
    steps:['own_add_program 保存 cells、app、drivers 和 animation；own_read_note 获取 note.id、cell.id、contentHash','own_configure_program_app 选择 Python 单元作为 Flask 入口；own_start_program_app 启动本机应用，在 Own 内嵌预览界面和请求响应','own_program_app_request 测试 GET/POST/JSON 接口，own_program_app_status 查看日志；own_stop_program_app 释放端口','own_run_program 或 own_start_program_debug 显式运行/调试，轮询 own_program_result；变量、stdout 和结果写回受源码 hash 保护','own_configure_program_driver 保存 TCP/Serial over LAN/UDP/WebSocket 参数；own_connect_program_driver 只返回等待用户确认，连接后再 own_send_program_data 或 own_read_program_stream'],
    example:{tool:'own_add_program',arguments:{boardId:'画布ID',requestId:'program-001',title:'响应面板',cells:[{language:'python',code:'from flask import Flask, request, jsonify\\nimport os\\napp = Flask(__name__)\\n@app.get("/")\\ndef home(): return "<h1>Own</h1>"\\n@app.post("/echo")\\ndef echo(): return jsonify(received=request.get_json(silent=True))\\nif __name__ == "__main__": app.run(host="127.0.0.1", port=int(os.environ.get("OWN_APP_PORT", "5000")))',stdin:''}],app:{framework:'flask',enabled:true},drivers:[{type:'serial-lan',host:'192.168.1.20',port:4001,encoding:'utf8'}],animation:{width:640,height:360,durationMs:3000,loop:true,frames:[{at:0,values:{x:0}},{at:3000,values:{x:320}}]}}},
    recovery:'应用配置不等于启动；启动前先检查入口代码。Own 优先使用真实 Flask，未安装时使用离线兼容层支持常用路由、request、jsonify 和 HTML。驱动配置不等于在线连接；先让用户核对地址、端口和数据方向。源码或输入改变后重新 own_read_note，不把旧 job 结果写回当前单元。',
  },
  web:{
    steps:['own_add_web_link(mode=preview|interactive) 保存网页卡片；interactive 仅表示请求交互','用户在 Own 画布点击“在画布中交互”，阅读来源、密码/令牌风险和 iframe 限制后确认；客户端保存 approvedOrigin','own_read_web_link 核对 approved、origin 和 mode；站点禁止 iframe 时使用系统浏览器打开'],
    example:{tool:'own_add_web_link',arguments:{boardId:'画布ID',requestId:'web-001',title:'内部文档',url:'https://docs.example.com',mode:'interactive'}},
    recovery:'MCP 永远不能设置 approvedOrigin/approvedAt。不要在嵌入网页中输入密码、令牌或银行卡信息。',
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
