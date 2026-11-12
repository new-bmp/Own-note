import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { addBase, target, id, color, mediaSettingsSchema, modelSettingsSchema, executionSchema } from './schemas.mjs'
import { validEntryPath, previewType, inferMime } from '../shared/attachments.js'
import { hash, checkProjectAction } from './project-policy.mjs'
const directoryEntry=z.object({path:z.string().min(1).max(4000),kind:z.enum(['directory','file']),assetId:id.optional(),mime:z.string().max(200).optional()}).strict()
const sides=z.enum(['top','right','bottom','left'])
export const connectionFields={label:z.string().max(300).optional(),style:z.enum(['curve','straight','elbow']).optional(),arrow:z.enum(['end','both','none']).optional(),dashed:z.boolean().optional(),color:color.optional(),fromSide:sides.optional(),toSide:sides.optional()}
export function registerAttachmentTools({tool,assets,readWorkspace,mutateWorkspace,getBoard,append,makeCard,receipt,readOnly,appendOnly,boardUrl}){
  tool('own_upload_asset','完整上传任意文件','分块上传文件内容，不读取本机任意路径。先 start 填 filename/size/sha256/mime/requestId；chunk 填 uploadId/offset/data（Base64，最多256KB）；commit 校验完整 SHA-256 后返回 assetId。随后 own_add_attachment 保存笔记。重复分块会核对字节。',{action:z.enum(['start','chunk','commit']),requestId:id.optional(),filename:z.string().min(1).max(255).optional(),size:z.number().int().min(0).max(104857600).optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),mime:z.string().regex(/^[\w.+-]+\/[\w.+-]+$/).optional(),uploadId:id.optional(),offset:z.number().int().min(0).optional(),data:z.string().max(349528).optional()},appendOnly,async args=>{
    if(args.action==='start'){if(!args.requestId||!args.filename||args.size===undefined||!args.sha256)throw new Error('start 需要 requestId、filename、size、sha256。');return assets.start({...args,mime:args.mime||inferMime(args.filename)})}
    if(!args.uploadId||args.action==='chunk'&&args.offset===undefined)throw new Error('需要 uploadId，chunk 还需要 offset 和 data。')
    return assets.write(args)
  })
  tool('own_add_attachment','保存文件、文件夹、媒体和 3D 资料','使用已上传 assetId 保存任意文件或图片；folder 传 entries，保留目录和空目录，可带 glTF/OBJ 配套资源。媒体和模型按文件名自动使用查看器；modelPath 可指定文件夹中的主模型。不会执行附件。',{...addBase,kind:z.enum(['file','image','folder']).default('file'),filename:z.string().min(1).max(255).optional(),assetId:id.optional(),entries:z.array(directoryEntry).max(10000).optional(),modelPath:z.string().max(4000).optional(),mediaSettings:mediaSettingsSchema.optional(),modelSettings:modelSettingsSchema.optional()},appendOnly,async args=>{
    const fields={caption:args.caption,color:args.color,filename:args.filename,mediaSettings:args.mediaSettings,modelSettings:args.modelSettings}
    if(args.kind==='folder'){
      if(!args.entries)throw new Error('文件夹需要 entries（空文件夹可传 []）。')
      const entries=new Map()
      for(const entry of args.entries){if(!validEntryPath(entry.path)||entries.has(entry.path))throw new Error('文件夹路径非法或重复。');entries.set(entry.path,{...entry})}
      for(const entry of [...entries.values()]){const parts=entry.path.split('/');for(let i=1;i<parts.length;i++){const p=parts.slice(0,i).join('/');if(entries.has(p)&&entries.get(p).kind!=='directory')throw new Error('文件不能作为父目录。');if(!entries.has(p))entries.set(p,{path:p,kind:'directory'})}if(entry.kind==='file'){if(!entry.assetId)throw new Error('每个文件条目需要 assetId。');const meta=await assets.info(entry.assetId);Object.assign(entries.get(entry.path),{size:meta.size,mime:inferMime(entry.path,meta.mime)})}}
      if(entries.size>10000)throw new Error('含父目录后最多 10000 个条目。')
      if(args.modelPath&&!entries.get(args.modelPath)?.assetId)throw new Error('主模型必须是文件夹中的有效文件。')
      Object.assign(fields,{entries:[...entries.values()].sort((a,b)=>a.path.localeCompare(b.path)),size:[...entries.values()].reduce((sum,e)=>sum+(e.size||0),0),modelPath:args.modelPath})
    }else{
      if(!args.assetId)throw new Error('文件需要 assetId，先 own_upload_asset。');const meta=await assets.info(args.assetId)
      Object.assign(fields,{assetId:meta.assetId,filename:args.filename||meta.filename||args.title,mime:meta.mime,size:meta.size})
    }
    const value=await append(args,makeCard(args.kind,args.title,fields));return {...value,viewer:args.kind==='folder'?'folder':previewType(fields.filename,fields.mime)}
  })
  tool('own_read_attachment','浏览文件夹与完整读取附件','用 noteId 和可选 path 读取笔记中的附件。文件夹未传 path 时分页列目录；文件返回指定字节范围 Base64、原文件 SHA-256、size 和 nextOffset。继续到 null 可无损还原任意文件。',{...target,noteId:id,path:z.string().max(4000).optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(262144).default(65536)},readOnly,async args=>{
    const {notebook}=await readWorkspace(),board=getBoard(notebook,args.projectId||args.boardId),note=board.notes.find(n=>n.id===args.noteId)
    if(!note)throw new Error('附件笔记不存在。')
    if(note.kind==='folder'&&!args.path){const limit=Math.min(args.limit,200);return {entries:(note.entries||[]).slice(args.offset,args.offset+limit),total:note.entries?.length||0,nextOffset:args.offset+limit<(note.entries?.length||0)?args.offset+limit:null,modelPath:note.modelPath}}
    if(args.path&&!validEntryPath(args.path))throw new Error('文件路径非法。')
    const assetId=args.path?note.entries?.find(e=>e.path===args.path&&e.kind==='file')?.assetId:note.assetId
    if(!assetId)throw new Error('指定笔记中没有该文件。')
    const {file,bytes,...metadata}=await assets.read(assetId,args.offset,args.limit)
    return {...metadata,offset:args.offset,bytes:bytes.length,encoding:'base64',data:bytes.toString('base64')}
  })
  tool('own_connect_notes','连接笔记与设置关系','创建两张笔记间的连线，支持直线/曲线/折线、双向箭头、虚线、标签、颜色和连接侧；支持独立 Agent 项目中的资料关系。requestId 防止重复。',{...target,requestId:id,from:id,to:id,execution:executionSchema.optional(),...connectionFields},appendOnly,async args=>mutateWorkspace(notebook=>{
    const board=getBoard(notebook,args.projectId||args.boardId);checkProjectAction(notebook,board.id,'notes',args.execution)
    const previous=board.connections.find(e=>e.requestId===args.requestId);if(previous){if(previous.fingerprint!==hash(args))throw new Error('requestId 已用于不同的关系。');return {notebook,unchanged:true,result:{connection:previous,contentHash:hash(previous),duplicate:true}}}
    if(args.from===args.to||![args.from,args.to].every(id=>board.notes.some(n=>n.id===id)))throw new Error('连接两端必须是当前画布或项目中不同的笔记。')
    const {boardId,projectId,requestId,execution,...fields}=args,connection={id:randomUUID(),...fields,requestId,fingerprint:hash(args)};board.connections.push(connection);board.updatedAt=Date.now();return {notebook,result:{connection,contentHash:hash(connection),duplicate:false}}
  }))
  tool('own_update_connection','修改笔记关系','读取 own_read_board.connections 的 contentHash 后更新连线样式、标签和侧；不改变任务依赖。',{...target,connectionId:id,expectedHash:z.string().length(64),execution:executionSchema.optional(),...connectionFields},{...appendOnly,destructiveHint:true,idempotentHint:false},async args=>mutateWorkspace(notebook=>{
    const board=getBoard(notebook,args.projectId||args.boardId);checkProjectAction(notebook,board.id,'notes',args.execution);const connection=board.connections.find(e=>e.id===args.connectionId)
    if(!connection||hash(connection)!==args.expectedHash)throw new Error('连线不存在或已被修改，请重新读取。')
    const {boardId,projectId,connectionId,expectedHash,execution,...patch}=args;Object.assign(connection,patch);board.updatedAt=Date.now();return {notebook,result:{connection,contentHash:hash(connection)}}
  }))
}
