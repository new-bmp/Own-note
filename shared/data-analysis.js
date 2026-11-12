export function parseDataset(source, format = 'csv') {
  if(typeof source!=='string'||source.length>2000000)throw new Error('数据源码最多 2000000 字符。')
  source=source.replace(/^\ufeff/,'')
  let matrix
  if(format==='json') {
    const value=JSON.parse(source)
    if(!Array.isArray(value)||!value.length)throw new Error('JSON 数据须为非空对象数组或二维数组。')
    if(value.every(v=>Array.isArray(v)))matrix=value
    else if(value.every(v=>v&&typeof v==='object'&&!Array.isArray(v))) {
      const keys=[...new Set(value.flatMap(v=>Object.keys(v)))];matrix=[keys,...value.map(v=>keys.map(k=>v[k]??''))]
    } else throw new Error('JSON 行类型不一致。')
  } else {
    const separator=format==='tsv'?'\t':','
    matrix=[];let row=[],cell='',quoted=false,closed=false
    for(let i=0;i<source.length;i++) {
      const c=source[i]
      if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue}
      if(c==='"'&&!cell&&!closed){quoted=true;continue}
      if(c===separator){row.push(cell);cell='';closed=false;continue}
      if(c==='\n'||c==='\r'){row.push(cell);if(row.some(v=>v.length))matrix.push(row);row=[];cell='';closed=false;if(c==='\r'&&source[i+1]==='\n')i++;continue}
      if(closed&&!/\s/.test(c))throw new Error('引号后的字符无效，请检查 CSV 格式。')
      if(!closed)cell+=c
    }
    if(quoted)throw new Error('CSV 有未闭合的双引号。')
    row.push(cell);if(row.some(v=>v.length))matrix.push(row)
  }
  if(!matrix?.length)throw new Error('请添加包含表头的数据。')
  const width=Math.max(...matrix.slice(0,50002).map(r=>r.length))
  if(width>200||matrix.length>50001)throw new Error('最多分析 50000 行、200 列；请缩小数据范围。')
  const names=Array.from({length:width},(_,i)=>String(matrix[0][i]??'').trim()||`列 ${i+1}`)
  const reserved=new Set(names),used=new Set()
  const columns=names.map(name=>{let label=name,suffix=2;if(used.has(label)){do{label=`${name} (${suffix++})`}while(used.has(label)||reserved.has(label))}used.add(label);return label})
  const rows=matrix.slice(1).map(row=>columns.map((_,i)=>{const value=row[i];const text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);if(text.length>20000)throw new Error('单元格超过 20000 字符。');return text}))
  return {columns,rows}
}
export const numeric = value => typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):undefined
export function summarize(columns,rows) {
  return columns.map((name,index)=>{
    const values=rows.map(r=>r[index]??''), numbers=values.map(numeric).filter(v=>v!==undefined).sort((a,b)=>a-b), n=numbers.length
    const sum=numbers.reduce((a,b)=>a+b,0),mean=n?sum/n:undefined
    return {name,count:values.length,missing:values.filter(v=>!v.trim()).length,unique:new Set(values.filter(v=>v.trim())).size,numericCount:n,sum:n?sum:undefined,mean,min:n?numbers[0]:undefined,max:n?numbers[n-1]:undefined,median:n?(numbers[Math.floor((n-1)/2)]+numbers[Math.ceil((n-1)/2)])/2:undefined,std:n>1?Math.sqrt(numbers.reduce((s,v)=>s+(v-mean)**2,0)/(n-1)):undefined}
  })
}
export function filterRows(rows, column, operator, value) {
  if(column<0||!value)return rows
  return rows.filter(row=>{const cell=row[column]||'';if(operator==='contains')return cell.toLowerCase().includes(value.toLowerCase());if(operator==='equals')return cell===value;const a=numeric(cell),b=numeric(value);return a!==undefined&&b!==undefined&&(operator==='greater'?a>b:a<b)})
}
export function aggregate(rows,group,value,method='sum') {
  const groups=new Map()
  for(const row of rows){const key=row[group]||'（空）',number=numeric(row[value]);const data=groups.get(key)||{sum:0,count:0,rows:0};data.rows++;if(number!==undefined){data.sum+=number;data.count++}groups.set(key,data)}
  return [...groups].filter(([,data])=>method==='count'||data.count>0).map(([label,data])=>({label,value:method==='count'?data.rows:method==='mean'?data.sum/data.count:data.sum})).sort((a,b)=>b.value-a.value)
}
export function datasetCsv(columns,rows,protectFormulas=true) {
  const quote=value=>{let v=String(value??'');if(protectFormulas&&(/^[\s]*[=+@\t\r]/.test(v)||/^\s*-/.test(v)&&numeric(v)===undefined))v="'"+v;return /[",\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v}
  return '\ufeff'+[columns,...rows].map(row=>row.map(quote).join(',')).join('\r\n')
}
