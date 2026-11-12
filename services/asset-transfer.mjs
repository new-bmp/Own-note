import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, writeFile, rename, copyFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
export function createAssetTransfer(assetsDir){
  const uploads=new Map(),requests=new Map(),imports=new Map(),maxSize=100*1024*1024
  let startQueue=Promise.resolve()
  const valid=id=>{if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new Error('无效附件 ID。');return path.join(assetsDir,id)}
  async function info(id){const prefix=valid(id),meta=JSON.parse(await readFile(prefix+'.json','utf8'));if(!/^[a-f0-9]{64}$/.test(meta.contentHash))throw new Error('附件元数据无效。');const file=prefix+'.'+meta.contentHash+'.blob';return {...meta,file,size:(await stat(file)).size,assetId:id}}
  async function read(id,offset,length){const meta=await info(id);if(offset>meta.size)throw new Error('附件读取偏移超出文件长度。');const file=await open(meta.file,'r');try{const bytes=Buffer.alloc(Math.min(length,meta.size-offset));const {bytesRead}=await file.read(bytes,0,bytes.length,offset);return {...meta,bytes:bytes.subarray(0,bytesRead),nextOffset:offset+bytesRead<meta.size?offset+bytesRead:null}}finally{await file.close()}}
  async function begin(args){
    const fingerprint=JSON.stringify(args),previous=requests.get(args.requestId)
    if(previous){if(previous.fingerprint!==fingerprint)throw new Error('上传 requestId 已用于不同内容。');return {uploadId:previous.id,...uploads.get(previous.id)?.result,nextOffset:uploads.get(previous.id)?.received||0}}
    for(const [id,v]of uploads)if(Date.now()-v.created>3600000){await rm(v.file,{force:true});uploads.delete(id);requests.delete(v.requestId)}
    if([...uploads.values()].filter(v=>!v.result).length>=16)throw new Error('最多同时保留 16 个未完成上传，请先完成已有上传。')
    if(uploads.size>=1000){const old=[...uploads.entries()].find(([,v])=>v.result);if(old){uploads.delete(old[0]);requests.delete(old[1].requestId)}}
    if(args.size>maxSize)throw new Error('单个附件最多 100 MB。')
    const id=randomUUID(),file=path.join(assetsDir,'.mcp-upload-'+id)
    await mkdir(assetsDir,{recursive:true});await writeFile(file,Buffer.alloc(0),{flag:'wx'})
    uploads.set(id,{...args,file,received:0,created:Date.now(),queue:Promise.resolve()});requests.set(args.requestId,{id,fingerprint});return {uploadId:id,nextOffset:0,chunkBytes:262144}
  }
  function start(args){const pending=startQueue.then(()=>begin(args));startQueue=pending.catch(()=>{});return pending}
  async function store(file,assetId,metadata){
    const prefix=valid(assetId),blob=prefix+'.'+metadata.contentHash+'.blob',temporary=prefix+'.'+randomUUID()+'.tmp'
    try{await copyFile(file,blob);await writeFile(temporary,JSON.stringify(metadata));await rename(temporary,prefix+'.json')}
    catch(error){await Promise.allSettled([rm(temporary,{force:true}),rm(blob,{force:true})]);throw error}
    return {assetId,...metadata,size:(await stat(blob)).size}
  }
  function ingest(file,assetId,filename,mime){
    if(imports.has(assetId))return imports.get(assetId)
    const pending=(async()=>{
      try{const {file:ignored,...value}=await info(assetId);return value}catch(error){if(error.code!=='ENOENT')throw error}
      if((await stat(file)).size>maxSize)throw new Error('转换结果超过附件 100 MB 上限，请另存后缩小。')
      const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes)
      return store(file,assetId,{filename,mime,contentHash:hash.digest('hex')})
    })();imports.set(assetId,pending);pending.catch(()=>imports.delete(assetId));return pending
  }
  async function write(args){
    const entry=uploads.get(args.uploadId);if(!entry)throw new Error('上传已过期，请重新 start。')
    const operation=entry.queue.then(async()=>{
      if(args.action==='commit'){
        if(entry.result)return entry.result
        if(entry.received!==entry.size)throw new Error(`附件尚未传完：${entry.received}/${entry.size} 字节。`)
        const hash=createHash('sha256');for await(const bytes of createReadStream(entry.file))hash.update(bytes);const contentHash=hash.digest('hex')
        if(contentHash!==entry.sha256)throw new Error('附件 SHA-256 不匹配，拒绝提交。')
        const assetId=randomUUID();entry.result=await store(entry.file,assetId,{mime:entry.mime,contentHash,filename:entry.filename});await rm(entry.file,{force:true});return entry.result
      }
      if(entry.result)throw new Error('上传已提交，不能追加。')
      if(!args.data||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.data))throw new Error('chunk.data 必须是有效 Base64。')
      const bytes=Buffer.from(args.data,'base64');if(bytes.length>262144||args.offset+bytes.length>entry.size)throw new Error('分块超出大小上限或申明的文件长度。')
      if(args.offset<entry.received){const file=await open(entry.file,'r');try{const old=Buffer.alloc(bytes.length);const read=await file.read(old,0,old.length,args.offset);if(args.offset+bytes.length>entry.received||read.bytesRead!==bytes.length||!old.equals(bytes))throw new Error('重试分块与已保存内容不同。')}finally{await file.close()}}
      else{if(args.offset!==entry.received)throw new Error(`下一块 offset 应为 ${entry.received}。`);const file=await open(entry.file,'a');try{await file.write(bytes)}finally{await file.close()}entry.received+=bytes.length}
      return {uploadId:args.uploadId,nextOffset:entry.received,received:entry.received,size:entry.size}
    });entry.queue=operation.catch(()=>{});return operation
  }
  return {info,read,start,write,ingest,close(){for(const entry of uploads.values())void entry.queue.then(()=>rm(entry.file,{force:true})).catch(()=>{})}}
}
