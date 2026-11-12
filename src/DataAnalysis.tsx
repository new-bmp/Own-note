import { useMemo, useState } from 'react'
import type { CanvasNote, AnalysisSettings } from './model'
import { parseDataset, summarize, filterRows, aggregate, datasetCsv, numeric } from '../shared/data-analysis.js'
import { RichPreview } from './RichContent'
import { downloadFile } from './storage'
import { readOffice } from './office-preview'
import { Download, Upload, ChartColumn, ClipboardPaste, Table2, Sigma, Plus, X, BarChart3, TrendingUp, PieChart } from 'lucide-react'

const display=(v:number|undefined)=>v===undefined?'—':Number(v.toFixed(6)).toLocaleString('zh-CN')
export function DataAnalysis({note,onChange,onChart,destination='画布'}:{note:CanvasNote;destination?:'画布'|'项目';onChange:(patch:Partial<CanvasNote>)=>void;onChart:(note:Partial<CanvasNote>)=>void}){
  const [error,setError]=useState(''),[page,setPage]=useState(0),[tab,setTab]=useState<'data'|'chart'|'stats'>('data')
  const [showPaste,setShowPaste]=useState(false),[paste,setPaste]=useState(''),[showFilter,setShowFilter]=useState(false)
  const settings=note.analysisSettings||{}
  const setting=(patch:Partial<AnalysisSettings>)=>onChange({analysisSettings:{...settings,...patch}})
  const parsed=useMemo(()=>{try{return {data:parseDataset(note.analysisSource||'',note.analysisFormat)}}catch(e){return {error:(e as Error).message}}},[note.analysisSource,note.analysisFormat])
  const data=parsed.data,width=data?.columns.length||1
  const defaults=useMemo(()=>{
    const sample=data?.rows.slice(0,100)||[]
    const value=data?.columns.findIndex((_,i)=>sample.some(row=>numeric(row[i])!==undefined))??-1
    const categories=data?.columns.map((_,i)=>({i,n:new Set(sample.map(row=>row[i])).size,numeric:sample.some(row=>numeric(row[i])!==undefined)})).filter(c=>!c.numeric)||[]
    return {value:value<0?Math.min(1,width-1):value,group:(categories.find(c=>c.n>1&&c.n<sample.length)||categories[0])?.i||0}
  },[data,width])
  const savedFilter=settings.filter||{column:-1,operator:'contains',value:''},savedSort=settings.sort||{column:-1,ascending:true}
  const filter={...savedFilter,column:savedFilter.column<width?savedFilter.column:-1},sort={...savedSort,column:savedSort.column<width?savedSort.column:-1}
  const group=Math.max(0,Math.min(settings.group??defaults.group,width-1)),value=Math.max(0,Math.min(settings.value??defaults.value,width-1)),method=settings.method||'sum',chartType=settings.chartType||'bar'
  const indexedRows=useMemo(()=>{
    if(!data)return []
    const accepted=new Set(filterRows(data.rows,filter.column,filter.operator,filter.value))
    const result=data.rows.map((row,index)=>({row,index})).filter(item=>accepted.has(item.row))
    if(sort.column>=0)result.sort((a,b)=>{const av=numeric(a.row[sort.column]),bv=numeric(b.row[sort.column]);return (av!==undefined&&bv!==undefined?av-bv:a.row[sort.column].localeCompare(b.row[sort.column],'zh-CN',{numeric:true}))*(sort.ascending?1:-1)})
    return result
  },[data,filter.column,filter.operator,filter.value,sort.column,sort.ascending])
  const rows=useMemo(()=>indexedRows.map(item=>item.row),[indexedRows])
  const stats=useMemo(()=>data?summarize(data.columns,rows):[],[data,rows])
  const groups=useMemo(()=>{
    const result=aggregate(rows,group,value,method)
    if(settings.order==='value')return result
    if(settings.order==='label')return result.sort((a,b)=>a.label.localeCompare(b.label,'zh-CN',{numeric:true}))
    const order=new Map([...new Set(rows.map(row=>row[group]||'（空）'))].map((label,i)=>[label,i]))
    return result.sort((a,b)=>(order.get(a.label)||0)-(order.get(b.label)||0))
  },[rows,group,value,method,settings.order])
  const chart=groups.length?{type:chartType,labels:groups.slice(0,60).map(v=>v.label),series:[{name:method==='count'?'数量':data?.columns[value]||'数值',values:groups.slice(0,60).map(v=>v.value)}]}:undefined
  const chartError=chart&&(chart.series[0].values.some(v=>!Number.isFinite(v)||Math.abs(v)>1e15)?'聚合值超过图表可用范围。':chartType==='pie'&&(chart.series[0].values.some(v=>v<0)||chart.series[0].values.every(v=>v===0))?'饼图需要非负且不全为零的数据。':'')
  const pages=Math.max(1,Math.ceil(rows.length/50)),currentPage=Math.min(page,pages-1),metric=stats[value]
  function acceptSource(source:string,format:'csv'|'tsv'|'json'){
    try{parseDataset(source,format);onChange({analysisSource:source,analysisFormat:format,analysisSettings:{}});setPage(0);setError('');setShowPaste(false)}catch(e){setError((e as Error).message)}
  }
  async function importFile(file:File){
    try{
      if(file.size>2000000)throw new Error('数据文件最多 2 MB。较大文件可作为附件保存。')
      const ext=file.name.split('.').at(-1)?.toLowerCase()
      if(ext==='xlsx'){
        const parts=readOffice(new Uint8Array(await file.arrayBuffer()),'xlsx',{analysis:true}),table=parts.find(p=>p.rows?.length)
        if(!table?.rows)throw new Error('工作簿中未找到数据。')
        acceptSource(datasetCsv(table.rows[0],table.rows.slice(1),false),'csv')
        if(parts.length>1)setError('已读取第一个有数据的工作表；其他工作表请分别导出 CSV。')
      }else acceptSource(await file.text(),ext==='json'?'json':ext==='tsv'?'tsv':'csv')
    }catch(e){setError((e as Error).message)}
  }
  function editData(columns:string[],next:string[][]){
    const source=datasetCsv(columns,next,false)
    if(source.length>2000000){setError('修改后的数据超过 2 MB，请缩小数据范围。');return}
    onChange({analysisSource:source,analysisFormat:'csv'});setError('')
  }
  const choices=(selected:number,label:string,change:(value:number)=>void,disabled=false)=><select aria-label={label} value={selected} disabled={disabled} onChange={e=>change(Number(e.target.value))}>{data?.columns.map((c,i)=><option key={i} value={i}>{c}{label==='数值列'&&stats[i]?.numericCount?' · 数值':''}</option>)}</select>
  return <div className="data-analysis analysis-v2">
    <div className="analysis-import-bar"><div><strong>从表格开始</strong><p>导入文件、粘贴 Excel，或直接修改下面的单元格。</p></div><label className="secondary-button"><Upload size={15}/>导入文件<input type="file" accept=".csv,.tsv,.json,.xlsx" hidden onChange={e=>{if(e.target.files?.[0])void importFile(e.target.files[0]);e.target.value=''}}/></label><button className="secondary-button" onClick={()=>setShowPaste(!showPaste)}><ClipboardPaste size={15}/>粘贴数据</button><button className="secondary-button" disabled={!data} onClick={()=>data&&downloadFile(new Blob([datasetCsv(data.columns,rows)],{type:'text/csv;charset=utf-8'}),`${note.title||'数据'}.csv`)}><Download size={15}/>导出结果</button></div>
    {showPaste&&<div className="data-paste-panel"><label>从 Excel 复制整块表格（含表头），或粘贴 CSV / JSON<textarea autoFocus aria-label="粘贴分析数据" value={paste} onChange={e=>setPaste(e.target.value)}/></label><div className="lab-actions"><button onClick={()=>acceptSource(paste,paste.trim().startsWith('[')?'json':paste.includes('\t')?'tsv':'csv')}>读取这些数据</button><button onClick={()=>setShowPaste(false)}>取消</button></div></div>}
    {(error||parsed.error)&&<p role="alert" className="lab-error">{error||parsed.error}</p>}
    {data&&<>
      <div className="analysis-metrics"><article><span>当前数据</span><strong>{rows.length.toLocaleString()} <small>/ {data.rows.length.toLocaleString()} 行</small></strong></article><article><span>{data.columns[value]} · 有效数值</span><strong>{metric?.numericCount||0}</strong></article><article><span>{data.columns[value]} · 合计</span><strong>{display(metric?.sum)}</strong></article><article><span>{data.columns[value]} · 平均</span><strong>{display(metric?.mean)}</strong></article></div>
      <nav className="analysis-tabs" aria-label="数据分析视图">{([['data','数据表',Table2],['chart','制作图表',ChartColumn],['stats','列统计',Sigma]]as const).map(([id,label,Icon])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon size={16}/>{label}</button>)}<button onClick={()=>setShowFilter(!showFilter)}>{filter.column>=0&&filter.value?'已启用筛选':'筛选数据'}</button></nav>
      {(showFilter||filter.column>=0&&filter.value)&&<div className="analysis-filter"><label>筛选列<select aria-label="筛选列" value={filter.column} onChange={e=>{setting({filter:{...filter,column:Number(e.target.value)}});setPage(0)}}><option value={-1}>全部行</option>{data.columns.map((c,i)=><option key={i} value={i}>{c}</option>)}</select></label><select aria-label="筛选条件" value={filter.operator} onChange={e=>{setting({filter:{...filter,operator:e.target.value}});setPage(0)}}><option value="contains">包含</option><option value="equals">等于</option><option value="greater">数值大于</option><option value="less">数值小于</option></select><input aria-label="筛选值" placeholder="输入条件" value={filter.value} onChange={e=>{setting({filter:{...filter,value:e.target.value}});setPage(0)}}/><button aria-label="清除数据筛选" onClick={()=>{setting({filter:{column:-1,operator:'contains',value:''}});setShowFilter(false);setPage(0)}}><X size={15}/></button></div>}
      {tab==='data'&&<>
        <p className="lab-help">点击单元格直接编辑，离开单元格后更新分析；点击列名旁的箭头排序。原始数据和设置随笔记保存。</p>
        <div className="editable-data-table analysis-grid"><table><thead><tr><th>#</th>{data.columns.map((c,i)=><th key={i}><div><input aria-label={`数据列 ${i+1} 名称`} key={c} defaultValue={c} onBlur={e=>{if(e.target.value.trim()&&e.target.value!==c)editData(data.columns.map((old,j)=>i===j?e.target.value:old),data.rows)}}/><button aria-label={`按${c}排序`} onClick={()=>setting({sort:{column:i,ascending:sort.column===i?!sort.ascending:true}})}>{sort.column===i?(sort.ascending?'↑':'↓'):'↕'}</button></div></th>)}<th/></tr></thead><tbody>{indexedRows.slice(currentPage*50,(currentPage+1)*50).map(({row,index})=><tr key={index}><th>{index+1}</th>{row.map((cell,j)=><td key={`${j}-${cell}`}><input aria-label={`数据第 ${index+1} 行第 ${j+1} 列`} defaultValue={cell} maxLength={20000} onBlur={e=>{if(e.target.value!==cell)editData(data.columns,data.rows.map((old,k)=>k===index?old.map((v,column)=>column===j?e.target.value:v):old))}}/></td>)}<td><button aria-label={`删除数据第 ${index+1} 行`} onClick={()=>editData(data.columns,data.rows.filter((_,i)=>i!==index))}><X size={13}/></button></td></tr>)}</tbody></table></div>
        <div className="lab-actions"><button disabled={data.rows.length>=50000} onClick={()=>{editData(data.columns,[...data.rows,data.columns.map(()=>'')]);setPage(Math.floor(data.rows.length/50))}}><Plus size={14}/>添加一行</button><button disabled={data.columns.length>=200} onClick={()=>editData([...data.columns,`新列 ${data.columns.length+1}`],data.rows.map(row=>[...row,'']))}><Plus size={14}/>添加一列</button><span className="analysis-page-count">第 {currentPage+1} / {pages} 页</span><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button><button disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>下一页</button><button className="primary-button" onClick={()=>setTab('chart')}>下一步：制作图表 →</button></div>
      </>}
      {tab==='chart'&&<div className="analysis-chart-workspace"><aside><h3>想看什么？</h3><label>按哪一列分组{choices(group,'分组列',group=>setting({group}))}</label><label>查看哪一列数值{choices(value,'数值列',value=>setting({value}),method==='count')}</label><label>怎样计算<select aria-label="聚合方式" value={method} onChange={e=>setting({method:e.target.value})}><option value="sum">求和：比较总量</option><option value="mean">平均：比较水平</option><option value="count">计数：比较记录数</option></select></label><label>类别排序<select aria-label="图表类别排序" value={settings.order||'source'} onChange={e=>setting({order:e.target.value as AnalysisSettings['order']})}><option value="source">保持数据顺序</option><option value="value">数值从高到低</option><option value="label">类别名称顺序</option></select></label><p className="lab-help">按「{data.columns[group]}」分组，{method==='count'?'统计记录数':`计算「${data.columns[value]}」的${method==='mean'?'平均值':'合计'}`}。空值不作为 0。</p><button className="primary-button" disabled={!chart||!!chartError} onClick={()=>chart&&onChart({kind:'chart',title:`${note.title} · ${data.columns[group]}`,chart,caption:`基于 ${rows.length} 行，按 ${data.columns[group]} 分组，${method==='count'?'计数':data.columns[value]+' '+(method==='mean'?'平均':'求和')}。${groups.length>60?'展示前 60 组。':''}`})}><ChartColumn size={16}/>把图表放到{destination}</button></aside><section>
        <div className="chart-type-picker">{([['bar','柱状图',BarChart3],['line','折线图',TrendingUp],['pie','饼图',PieChart]]as const).map(([id,label,Icon])=><button aria-pressed={chartType===id} key={id} onClick={()=>setting({chartType:id})}><Icon size={16}/>{label}</button>)}</div>
        {chartError&&<p role="alert" className="lab-error">{chartError}</p>}{chart&&!chartError?<div className="analysis-chart"><RichPreview note={{...note,kind:'chart',chart}}/></div>:!chart&&<p className="analysis-empty">当前列没有可聚合的数值。请选择标有「数值」的列，或选择「计数」。</p>}{groups.length>60&&<p className="lab-warning">共 {groups.length} 组，显示当前顺序的前 60 组。</p>}
        <div className="analysis-table"><table><thead><tr><th>{data.columns[group]}</th><th>{method==='count'?'记录数':data.columns[value]}</th></tr></thead><tbody>{groups.slice(0,60).map(item=><tr key={item.label}><td>{item.label}</td><td>{display(item.value)}</td></tr>)}</tbody></table></div>
      </section></div>}
      {tab==='stats'&&<><p className="lab-help">统计基于当前筛选。非数值文本不会参与求和、平均和标准差计算。</p><div className="analysis-table"><table><thead><tr>{['列名','有效数值','空值','不同值','合计','平均','中位数','最小','最大','标准差（样本）'].map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{stats.map(s=><tr key={s.name}><th>{s.name}</th><td>{s.numericCount}</td><td>{s.missing}</td><td>{s.unique}</td>{[s.sum,s.mean,s.median,s.min,s.max,s.std].map((v,i)=><td key={i}>{display(v)}</td>)}</tr>)}</tbody></table></div></>}
    </>}
    <details className="analysis-source-details"><summary>高级：查看或编辑原始数据</summary><div className="lab-actions"><label>格式<select aria-label="数据格式" value={note.analysisFormat||'csv'} onChange={e=>onChange({analysisFormat:e.target.value as 'csv'|'tsv'|'json'})}><option value="csv">CSV</option><option value="tsv">TSV</option><option value="json">JSON</option></select></label></div><textarea className="dataset-source" aria-label="数据源码" value={note.analysisSource||''} onChange={e=>{onChange({analysisSource:e.target.value});setPage(0)}}/></details>
  </div>
}
