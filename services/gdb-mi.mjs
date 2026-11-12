// Parse GDB/MI values without evaluating debugger output as JavaScript.
export function parseMi(line){
  const match=line.match(/^(\d*)([\^*+=~@&])(.*)$/)
  if(!match)return null
  const [,token,kind,body]=match
  let at=0
  const string=()=>{let out='';at++;while(at<body.length){const c=body[at++];if(c==='"')return out;if(c!=='\\'){out+=c;continue}const next=body[at++];if(/[0-7]/.test(next)){let oct=next;while(oct.length<3&&/[0-7]/.test(body[at]||'x'))oct+=body[at++];out+=String.fromCharCode(parseInt(oct,8))}else out+=({n:'\n',r:'\r',t:'\t','"':'"','\\':'\\'}[next]??next)}return out}
  function value(){
    if(body[at]==='"')return string()
    if(body[at]==='{'){at++;const obj={};while(at<body.length&&body[at]!=='}'){const [key,val]=result();obj[key]=val;if(body[at]===',')at++;else break}at++;return obj}
    if(body[at]==='['){at++;const list=[];while(at<body.length&&body[at]!==']'){if(/^[\w-]+=/.test(body.slice(at))){const [key,val]=result();list.push({[key]:val})}else list.push(value());if(body[at]===',')at++;else break}at++;return list}
    const start=at;while(at<body.length&&!/[,\]}]/.test(body[at]))at++;return body.slice(start,at)
  }
  function result(){const start=at;while(at<body.length&&body[at]!=='=')at++;const key=body.slice(start,at++);return [key,value()]}
  if('~@&'.includes(kind))return {token:Number(token)||undefined,kind,text:value()}
  const name=body.split(',')[0];at=name.length;const data={}
  while(body[at]===','){at++;const [key,val]=result();data[key]=val}
  return {token:Number(token)||undefined,kind,name,data}
}
