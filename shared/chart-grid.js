import { parseDataset, numeric } from './data-analysis.js'
export const chartGrid = chart => [['类别',...chart.series.map(s=>s.name)],...chart.labels.map((label,i)=>[label,...chart.series.map(s=>String(s.values[i]))])]
export function clipboardGrid(text){const data=parseDataset(text,text.includes('\t')?'tsv':'csv');return [data.columns,...data.rows]}
export function chartFromGrid(grid,type='bar',unit=''){
  if(grid.length<2||grid.length>61)throw new Error('图表需要 1–60 行数据。')
  const width=grid[0]?.length
  if(width<2||width>7)throw new Error('第一列为类别，后面可有 1–6 组数值。')
  if(!['bar','line','pie'].includes(type))throw new Error('请选择柱状图、折线图或饼图。')
  if(unit.trim().length>40)throw new Error('图表单位最多 40 字。')
  if(grid[0].slice(1).some(name=>name.trim().length>120))throw new Error('数值系列名称最多 120 字。')
  const labels=grid.slice(1).map((row,i)=>{if(!row[0]?.trim())throw new Error(`第 ${i+1} 行需要类别名称。`);if(row[0].trim().length>120)throw new Error(`第 ${i+1} 行类别名称最多 120 字。`);return row[0].trim()})
  const series=grid[0].slice(1).map((name,column)=>({name:name.trim()||`数值 ${column+1}`,values:grid.slice(1).map((row,index)=>{const value=numeric(row[column+1]);if(value===undefined||Math.abs(value)>1e15)throw new Error(`第 ${index+1} 行「${name}」需要有效数值。`);return value})}))
  if(type==='pie'&&(series.length!==1||series[0].values.some(v=>v<0)||series[0].values.every(v=>v===0)))throw new Error('饼图需要一组非负、且不全为零的数值；可切换柱状图比较多组数据。')
  return {type,labels,series,...(unit.trim()?{unit:unit.trim()}:{})}
}
