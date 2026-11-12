import { useState } from 'react'
import { Plus, Trash2, ClipboardPaste, BarChart3, TrendingUp, PieChart } from 'lucide-react'
import type { ChartSpec } from './model'
import { chartGrid, chartFromGrid, clipboardGrid } from '../shared/chart-grid.js'

export function ChartBuilder({chart,onChange}:{chart:ChartSpec;onChange:(chart:ChartSpec)=>void}){
  const [grid,setGrid]=useState(()=>chartGrid(chart)),[type,setType]=useState(chart.type),[unit,setUnit]=useState(chart.unit||''),[error,setError]=useState(''),[paste,setPaste]=useState(''),[showPaste,setShowPaste]=useState(false)
  function update(next:string[][],kind=type,measure=unit){setGrid(next);setType(kind);setUnit(measure);try{onChange(chartFromGrid(next,kind,measure));setError('')}catch(e){setError((e as Error).message);onChange({...chart,type:kind,labels:[],series:[]})}}
  function cell(row:number,column:number,value:string){update(grid.map((cells,i)=>i===row?cells.map((old,j)=>j===column?value:old):cells))}
  return <div className="chart-builder">
    <div className="chart-type-picker" aria-label="图表类型">{([['bar','柱状图',BarChart3],['line','折线图',TrendingUp],['pie','饼图',PieChart]]as const).map(([value,label,Icon])=><button key={value} aria-pressed={type===value} onClick={()=>update(grid,value)}><Icon size={17}/>{label}</button>)}</div>
    <div className="lab-actions"><button onClick={()=>setShowPaste(!showPaste)}><ClipboardPaste size={15}/>粘贴 Excel / CSV</button><label>单位<input aria-label="图表单位" placeholder="例如 元、小时、%" maxLength={40} value={unit} onChange={e=>update(grid,type,e.target.value)}/></label></div>
    {showPaste&&<div className="data-paste-panel"><label>粘贴含表头的数据，第一列为类别<textarea aria-label="粘贴图表数据" value={paste} onChange={e=>setPaste(e.target.value)} placeholder={'类别\t本月\t上月\n设计\t12\t8\n开发\t20\t15'}/></label><button className="secondary-button" onClick={()=>{try{const next=clipboardGrid(paste);chartFromGrid(next,type,unit);update(next);setShowPaste(false)}catch(e){setError((e as Error).message)}}}>用这些数据更新图表</button></div>}
    <p className="lab-help">直接修改表格，右侧立即更新。第一列填写类别；其余列填写数值。最多 60 行、6 组数值。</p>
    <div className="editable-data-table"><table><thead><tr><th>#</th>{grid[0].map((name,column)=><th key={column}><input aria-label={column===0?'类别列表头':`数据系列 ${column} 名称`} value={name} maxLength={120} onChange={e=>cell(0,column,e.target.value)}/>{column>0&&grid[0].length>2&&<button aria-label={`移除数据系列 ${column}`} onClick={()=>update(grid.map(row=>row.filter((_,i)=>i!==column)))}><Trash2 size={12}/></button>}</th>)}<th/></tr></thead><tbody>{grid.slice(1).map((row,index)=><tr key={index}><th>{index+1}</th>{row.map((value,column)=><td key={column}><input aria-label={`图表第 ${index+1} 行${column===0?'类别':`数值 ${column}`}`} value={value} maxLength={column?100:120} inputMode={column?'decimal':undefined} onChange={e=>cell(index+1,column,e.target.value)}/></td>)}<td><button disabled={grid.length<=2} aria-label={`删除图表第 ${index+1} 行`} onClick={()=>update(grid.filter((_,i)=>i!==index+1))}><Trash2 size={13}/></button></td></tr>)}</tbody></table></div>
    <div className="lab-actions"><button disabled={grid.length>=61} onClick={()=>update([...grid,grid[0].map((_,i)=>i?'0':`类别 ${grid.length}`)])}><Plus size={14}/>添加一行</button><button disabled={grid[0].length>=7||type==='pie'} onClick={()=>update(grid.map((row,i)=>[...row,i?'0':`数值 ${row.length}`]))}><Plus size={14}/>添加数值系列</button></div>
    {error&&<p role="alert" className="lab-error">{error}</p>}
  </div>
}
