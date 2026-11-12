const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const keyed=new Set(['boards','notes','connections','items','cells','agents'])
export class MergeConflict extends Error {}
// A three-way merge keeps independent user edits and Agent reports. A changed
// value is never silently selected over a different edit to that same value.
export function mergeWorkspaces(base,local,remote) {
  function merge(before,left,right,path='workspace') {
    if(same(left,right)||same(right,before))return left
    if(same(left,before))return right
    const key=path.split('.').at(-1)
    if(['updatedAt','lastOpenedAt'].includes(key)&&[left,right].every(Number.isFinite))return Math.max(left,right)
    if(path.endsWith('.concept.lease')&&left===undefined&&before?.token===right?.token&&before?.revision===right?.revision)return undefined
    if(key==='history'&&[before,left,right].every(Array.isArray)&&same(left.slice(0,before.length),before)&&same(right.slice(0,before.length),before)){
      const values=[...before,...left.slice(before.length),...right.slice(before.length)]
      return [...new Map(values.map(value=>[JSON.stringify(value),value])).values()].sort((a,b)=>a.at-b.at).slice(-200)
    }
    if([before,left,right].every(object)) {
      const result={}
      for(const field of new Set([...Object.keys(before),...Object.keys(left),...Object.keys(right)])){
        const value=merge(before[field],left[field],right[field],path+'.'+field)
        if(value!==undefined)result[field]=value
      }
      return result
    }
    if(keyed.has(key)&&[before,left,right].every(Array.isArray)&&[...before,...left,...right].every(value=>object(value)&&typeof value.id==='string')){
      const maps=[before,left,right].map(items=>new Map(items.map(item=>[item.id,item])))
      const common=before.filter(item=>maps[1].has(item.id)&&maps[2].has(item.id)).map(item=>item.id)
      const order=items=>items.filter(item=>common.includes(item.id)).map(item=>item.id)
      const leftOrder=order(left),rightOrder=order(right)
      if(!same(leftOrder,common)&&!same(rightOrder,common)&&!same(leftOrder,rightOrder))throw new MergeConflict(path)
      const priority=!same(rightOrder,common)?[...right,...left]:[...left,...right]
      const result=[]
      for(const id of new Set([...priority,...before].map(item=>item.id))){const value=merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),path+'.'+id);if(value!==undefined)result.push(value)}
      return result
    }
    throw new MergeConflict(path)
  }
  return merge(base,local,remote)
}
