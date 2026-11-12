import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, cp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const toolchainsDir=path.join(root,'.toolchains')
const cache=path.join(toolchainsDir,'downloads')
const common=[
  {id:'mingw',version:'16.2.0',url:'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-23.1.3-14.0.0-ucrt-r3/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r3.zip',sha256:'3c69305081e4a647144339a936244fcf7d3d9e558319e1ad7be2cd2886d4b6a1',nested:true,probe:'bin/g++.exe',source:'https://winlibs.com/'},
  {id:'python',version:'3.13.7',url:'https://www.python.org/ftp/python/3.13.7/python-3.13.7-embed-amd64.zip',sha256:'f6cca216a359be84797cabb54149ce5e062afb16cc7567eb7fc51cacb2d86b65',probe:'python.exe',source:'https://www.python.org/downloads/release/python-3137/'},
  {id:'java',version:'21.0.13+9',url:'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip',sha256:'a4dbaa05fca4bd89d84584e58c459bd732efebb1722af80ab13c6516832004f9',nested:true,probe:'bin/java.exe',source:'https://adoptium.net/temurin/releases/'},
  {id:'go',version:'1.27.4',url:'https://go.dev/dl/go1.27.4.windows-amd64.zip',sha256:'178ab98950ac69ab25069307dc6ade79f3816e414cce95b4da166a115cde1e7e',nested:true,probe:'bin/go.exe',source:'https://go.dev/dl/'},
]
const run=(command,args,env)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,stdio:'inherit',...(env?{env:{...process.env,...env}}:{})});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command}: ${code}`)))})
function downloadUrl(url){
  if(process.env.OWN_TOOLCHAIN_MIRROR!=='cn')return url
  if(url.startsWith('https://github.com/'))return 'https://ghfast.top/'+url
  if(url.startsWith('https://www.python.org/ftp/python/'))return url.replace('https://www.python.org/ftp/python/','https://registry.npmmirror.com/-/binary/python/')
  if(url.startsWith('https://static.rust-lang.org/'))return url.replace('https://static.rust-lang.org/','https://rsproxy.cn/')
  return url
}
// Schannel still verifies the certificate chain. Offline revocation endpoints
// should not prevent a download whose complete SHA-256 is checked below.
const fetchFile=(url,output)=>run('curl.exe',['--ssl-revoke-best-effort','--location','--fail','--silent','--show-error','--connect-timeout','30','--max-time','1200','--retry','3','--output',output,url])
async function digest(filename){const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex')}
async function download(spec){
  await mkdir(cache,{recursive:true})
  const filename=path.join(cache,path.basename(new URL(spec.url).pathname)),partial=filename+'.partial'
  if(existsSync(filename)&&(!spec.sha256||await digest(filename)===spec.sha256))return filename
  console.log(`下载 ${spec.id} ${spec.version}: ${spec.url}`)
  await fetchFile(downloadUrl(spec.url),partial)
  const hash=await digest(partial)
  if(spec.sha256&&hash!==spec.sha256)throw new Error(`工具链校验不一致：${spec.id}`)
  await rename(partial,filename)
  spec.sha256=hash
  return filename
}
async function prepare(spec){
  const target=path.join(toolchainsDir,spec.id),receipt=path.join(target,'own-toolchain.json')
  if(existsSync(receipt)&&existsSync(path.join(target,spec.probe)))return JSON.parse(await readFile(receipt,'utf8'))
  const archive=await download(spec),staging=path.join(toolchainsDir,`.extract-${spec.id}`)
  await mkdir(staging,{recursive:true});await run('tar.exe',['-xf',archive,'-C',staging])
  const directories=await readdir(staging,{withFileTypes:true})
  const source=spec.nested?path.join(staging,directories.find(d=>d.isDirectory()).name):staging
  if(!existsSync(path.join(source,spec.probe)))throw new Error(`工具链缺少 ${spec.probe}`)
  if(existsSync(target))throw new Error(`未完成的工具链目录请检查：${target}`)
  if(source===staging)await rename(staging,target)
  else {await rename(source,target);await rm(staging,{recursive:true,force:true})}
  const result={...spec,sha256:spec.sha256||await digest(archive)}
  await writeFile(receipt,JSON.stringify(result,null,2));console.log(`工具链就绪：${spec.id}`)
  return result
}
async function prepareRust(){
  const target=path.join(toolchainsDir,'rust'),receipt=path.join(target,'own-toolchain.json')
  if(existsSync(receipt)&&existsSync(path.join(target,'bin','rustc.exe')))return JSON.parse(await readFile(receipt,'utf8'))
  const manifestFile=path.join(cache,'channel-rust-stable.toml')
  const manifestUrl='https://static.rust-lang.org/dist/channel-rust-stable.toml'
  await fetchFile(manifestUrl+'.sha256',manifestFile+'.sha256')
  await fetchFile(downloadUrl(manifestUrl),manifestFile)
  const manifestHash=(await readFile(manifestFile+'.sha256','utf8')).split(/\s/)[0]
  if(!/^[a-f\d]{64}$/.test(manifestHash)||await digest(manifestFile)!==manifestHash)throw new Error('Rust 发行清单校验不一致。')
  const manifest=await readFile(manifestFile,'utf8'),version=manifest.match(/\[pkg.rustc\]\s+version = "([^"]+)"/)?.[1]
  if(!version)throw new Error('Rust 发行信息无效。')
  const parts=[]
  for(const component of ['rustc','rust-std','rust-mingw']){
    const heading=`[pkg.${component}.target.x86_64-pc-windows-gnu]`,section=manifest.split(heading)[1]?.split('\n[')[0]
    const url=section?.match(/xz_url = "([^"]+)"/)?.[1],sha256=section?.match(/xz_hash = "([^"]+)"/)?.[1]
    if(!url||!sha256)throw new Error(`缺少 Rust ${component} Windows GNU 组件。`)
    const spec={id:`rust-${component}`,version,url,sha256},archive=await download(spec),staging=path.join(toolchainsDir,`.extract-${spec.id}`)
    await mkdir(staging,{recursive:true});await run('tar.exe',['-xf',archive,'-C',staging])
    const top=(await readdir(staging,{withFileTypes:true})).find(d=>d.isDirectory()).name
    const location=path.join(staging,top),componentName=(await readFile(path.join(location,'components'),'utf8')).trim()
    await mkdir(target,{recursive:true});await cp(path.join(location,componentName),target,{recursive:true})
    for(const name of (await readdir(location)).filter(name=>/COPYRIGHT|LICENSE/.test(name)))await cp(path.join(location,name),path.join(target,component+'-'+name))
    await rm(staging,{recursive:true,force:true});parts.push(spec)
  }
  const result={id:'rust',version,parts,source:'https://www.rust-lang.org/tools/install'}
  await writeFile(receipt,JSON.stringify(result,null,2));return result
}
export async function prepareToolchains({optional=true}={}){
  if(process.platform!=='win32')throw new Error('目前打包 Windows x64 工具链。')
  await mkdir(toolchainsDir,{recursive:true})
  const results=await Promise.allSettled(common.filter(s=>optional||['mingw','python'].includes(s.id)).map(prepare))
  for(const result of results)if(result.status==='rejected')throw result.reason
  const manifest=results.map(result=>result.value)
  if(optional)manifest.push(await prepareRust())
  await writeFile(path.join(toolchainsDir,'manifest.json'),JSON.stringify(manifest,null,2))
  return manifest
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareToolchains({optional:!process.argv.includes('--common')})
