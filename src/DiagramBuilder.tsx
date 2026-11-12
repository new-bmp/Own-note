import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { diagramSource, parseDiagram, diagramTemplates } from '../shared/diagram-builder.js'
import type { EditableDiagram } from '../shared/diagram-builder.js'

export function DiagramBuilder({ source, onChange }: { source: string; onChange: (value: string) => void }) {
  const graph = parseDiagram(source)
  const [mode, setMode] = useState<'form' | 'source'>(graph ? 'form' : 'source')
  const [template, setTemplate] = useState('')
  const update = (graph: EditableDiagram) => onChange(diagramSource(graph))
  function applyTemplate(value: string) {
    if (value === 'flow' || value === 'decision') onChange(diagramSource(diagramTemplates[value]))
    if (value === 'sequence') onChange('sequenceDiagram\n  participant U as 使用者\n  participant O as Own\n  U->>O: 记录想法\n  O-->>U: 保存完成')
    if (value === 'mindmap') onChange('mindmap\n  root((项目计划))\n    目标\n    行动\n    资料')
    setMode(value === 'flow' || value === 'decision' ? 'form' : 'source'); setTemplate('')
  }
  return <div className="diagram-builder">
    <div className="editor-mode-tabs"><button className={mode === 'form' ? 'active' : ''} disabled={!graph} onClick={() => setMode('form')}>图形制作</button><button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>Mermaid 源码</button></div>
    <div className="diagram-templates"><label>新建模板<select aria-label="选择图形模板" value={template} onChange={(event) => setTemplate(event.target.value)}><option value="">选择模板…</option><option value="flow">工作流程</option><option value="decision">判断与分支</option><option value="sequence">时序图（源码）</option><option value="mindmap">思维导图（源码）</option></select></label><button className="secondary-button" disabled={!template} onClick={() => applyTemplate(template)}>替换为模板</button></div>
    {mode === 'source' ? <><p className="authoring-help">{graph ? '可随时切回图形制作。' : '此图包含高级语法，请在源码中继续编辑。使用上方模板会替换当前内容。'}</p><textarea className="diagram-source" aria-label="Mermaid 源码" spellCheck={false} value={source} onChange={(event) => onChange(event.target.value)} /></> : graph && <div className="diagram-form">
      <label className="diagram-direction">阅读方向<select aria-label="图形阅读方向" value={graph.direction} onChange={(event) => update({ ...graph, direction: event.target.value as EditableDiagram['direction'] })}><option value="LR">从左到右 →</option><option value="TB">从上到下 ↓</option><option value="RL">从右到左 ←</option><option value="BT">从下到上 ↑</option></select></label>
      <div className="builder-heading"><strong>节点</strong><small>填写中文名称，选择形状</small></div>
      {graph.nodes.map((node, index) => <div className="builder-node" key={node.id}><span>{index + 1}</span><input aria-label={`节点 ${index + 1} 名称`} maxLength={160} value={node.label} placeholder="输入节点名称" onChange={(event) => update({ ...graph, nodes: graph.nodes.map((n) => n.id === node.id ? { ...n, label: event.target.value } : n) })} /><select aria-label={`节点 ${index + 1} 形状`} value={node.shape} onChange={(event) => update({ ...graph, nodes: graph.nodes.map((n) => n.id === node.id ? { ...n, shape: event.target.value as typeof node.shape } : n) })}><option value="box">矩形</option><option value="round">圆角</option><option value="decision">判断 ◇</option></select><button aria-label={`删除节点 ${index + 1}`} disabled={graph.nodes.length === 1} onClick={() => update({ ...graph, nodes: graph.nodes.filter((n) => n.id !== node.id), edges: graph.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id) })}><Trash2 size={14} /></button></div>)}
      <button className="builder-add" disabled={graph.nodes.length >= 80} onClick={() => {
        let count = 1; while (graph.nodes.some((node) => node.id === `N${count}`)) count++
        update({ ...graph, nodes: [...graph.nodes, { id: `N${count}`, label: '新节点', shape: 'box' }] })
      }}><Plus size={14} />添加节点</button>
      <div className="builder-heading"><strong>连接</strong><small>选择起点、终点，可填写关系</small></div>
      {graph.edges.map((edge, index) => {
        const change = (patch: Partial<typeof edge>) => update({ ...graph, edges: graph.edges.map((e, i) => i === index ? { ...e, ...patch } : e) })
        return <div className="builder-edge" key={index}><div className="builder-edge-endpoints"><select aria-label={`连接 ${index + 1} 起点`} value={edge.from} onChange={(event) => change({ from: event.target.value })}>{graph.nodes.map((node, i) => <option key={node.id} value={node.id}>{i + 1}. {node.label || '未命名'}</option>)}</select><span>→</span><select aria-label={`连接 ${index + 1} 终点`} value={edge.to} onChange={(event) => change({ to: event.target.value })}>{graph.nodes.map((node, i) => <option key={node.id} value={node.id}>{i + 1}. {node.label || '未命名'}</option>)}</select><button aria-label={`删除连接 ${index + 1}`} onClick={() => update({ ...graph, edges: graph.edges.filter((_, i) => i !== index) })}><Trash2 size={14} /></button></div><div className="builder-edge-options"><input aria-label={`连接 ${index + 1} 关系`} maxLength={160} placeholder="关系文字（可选）" value={edge.label} onChange={(event) => change({ label: event.target.value })} /><label><input type="checkbox" checked={edge.dashed} onChange={(event) => change({ dashed: event.target.checked })} />虚线</label><label><input type="checkbox" checked={edge.arrow} onChange={(event) => change({ arrow: event.target.checked })} />箭头</label></div></div>
      })}
      <button className="builder-add" disabled={graph.nodes.length < 2 || graph.edges.length >= 160} onClick={() => update({ ...graph, edges: [...graph.edges, { from: graph.nodes[0].id, to: graph.nodes[1].id, label: '', dashed: false, arrow: true }] })}><Plus size={14} />连接两个节点</button>
    </div>}
  </div>
}
