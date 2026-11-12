import { existsSync, mkdtempSync, symlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const compilerAliases=new Map()
function compilerDirectory(root){
  const directory=path.join(root,'mingw')
  if(process.platform!=='win32'||!/[^\x21-\x7e]/.test(directory)||!existsSync(directory))return directory
  if(compilerAliases.has(directory))return compilerAliases.get(directory)
  // GCC's narrow path handling cannot link from some translated install paths.
  // Use a private junction together with -no-canonical-prefixes when compiling.
  const temporary=mkdtempSync(path.join(tmpdir(),'own-compiler-')),alias=path.join(temporary,'mingw')
  try{symlinkSync(directory,alias,'junction')}catch(error){rmdirSync(temporary);throw error}
  compilerAliases.set(directory,alias)
  process.once('exit',()=>{try{rmdirSync(alias);rmdirSync(temporary)}catch{}})
  return alias
}
export function toolchainPaths(){
  const root=process.env.OWN_TOOLCHAIN_DIR||(existsSync(path.join(appRoot,'.toolchains','python'))?path.join(appRoot,'.toolchains'):path.resolve(appRoot,'../runtime/toolchains'))
  const compilerRoot=compilerDirectory(root)
  const bin=(id,name)=>path.join(id==='mingw'?compilerRoot:path.join(root,id),'bin',name+'.exe')
  const find=(filename,fallback)=>existsSync(filename)?filename:fallback
  return {root,compilerRoot,node:process.execPath,python:find(path.join(root,'python','python.exe'),'python'),c:find(bin('mingw','gcc'),'gcc'),cpp:find(bin('mingw','g++'),'g++'),gdb:find(bin('mingw','gdb'),'gdb'),java:find(bin('java','java'),'java'),go:find(bin('go','go'),'go'),rust:find(bin('rust','rustc'),'rustc')}
}
export function executionEnv(directory,extra={}){
  const paths=toolchainPaths(),env=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOME','LANG','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))
  const bins=[path.join(paths.compilerRoot,'bin'),...['java','go','rust'].map(id=>path.join(paths.root,id,'bin'))].filter(existsSync)
  delete env.Path;env.PATH=[...bins,process.env.PATH||process.env.Path||''].join(path.delimiter)
  if(paths.java!=='java')env.JAVA_HOME=path.join(paths.root,'java')
  if(paths.go!=='go')env.GOROOT=path.join(paths.root,'go')
  env.GOCACHE=path.join(directory,'go-cache');env.GOPATH=path.join(directory,'go-packages')
  return {...env,...extra}
}
