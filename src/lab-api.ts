export interface LabJob {id:string;kind:string;status:'running'|'success'|'error'|'stopped';stdout:string;stderr:string;reason?:string;exitCode?:number;truncated?:boolean;startedAt:number;finishedAt?:number;url?:string;mime?:string}
export async function labRequest<T>(url:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
  const response=await fetch(url,{method,headers:body!==undefined?{'Content-Type':'application/json'}:{},...(body!==undefined?{body:JSON.stringify(body)}:{})})
  const data=await response.json();if(!response.ok)throw new Error(data.error||'工作台服务暂时不可用。');return data
}
export async function watchJob(id:string,onProgress:(job:LabJob)=>void,signal:AbortSignal){
  while(!signal.aborted){
    const job=await labRequest<LabJob>(`/api/lab/jobs/${id}`)
    if(signal.aborted)return
    onProgress(job)
    if(job.status!=='running')return job
    await new Promise<void>(resolve=>{
      const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve()}
      const timer=setTimeout(finish,350)
      signal.addEventListener('abort',finish,{once:true})
      if(signal.aborted)finish()
    })
  }
}
