import { ArrowLeftRight, Trash2, X } from 'lucide-react'
import type { Connection } from './model'
export function ConnectionPanel({ edge, onChange, onDelete, onClose }: {
  edge: Connection; onChange: (patch: Partial<Connection>) => void; onDelete: () => void; onClose: () => void
}) {
  return <aside className="connection-panel" data-canvas-ui aria-label="连线设置" onPointerDown={(event) => event.stopPropagation()}>
    <header><strong>卡片关系</strong><button aria-label="关闭连线设置" onClick={onClose}><X size={16} /></button></header>
    <label>关系文字<input aria-label="关系文字" maxLength={200} value={edge.label || ''} placeholder="例如：依赖、参考、下一步" onChange={(event) => onChange({ label: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
    <div className="connection-panel-row"><label>走线<select aria-label="连线走线" value={edge.style || 'curve'} onChange={(event) => onChange({ style: event.target.value as Connection['style'] })}><option value="curve">曲线</option><option value="straight">直线</option><option value="elbow">折线</option></select></label>
      <label>箭头<select aria-label="连线箭头" value={edge.arrow || 'end'} onChange={(event) => onChange({ arrow: event.target.value as Connection['arrow'] })}><option value="end">单向 →</option><option value="both">双向 ↔</option><option value="none">无箭头</option></select></label></div>
    <div className="connection-panel-row"><label className="connection-check"><input type="checkbox" checked={!!edge.dashed} onChange={(event) => onChange({ dashed: event.target.checked })} />虚线</label><label className="connection-color">颜色<input aria-label="连线颜色" type="color" value={edge.color || '#8c99a4'} onChange={(event) => onChange({ color: event.target.value })} /></label></div>
    <footer><button onClick={() => onChange({ from: edge.to, to: edge.from, fromSide: edge.toSide, toSide: edge.fromSide })}><ArrowLeftRight size={14} />反向</button><button onClick={onDelete}><Trash2 size={14} />删除</button></footer>
    <small>从卡片边缘的圆点拖到另一张卡片，即可连接。</small>
  </aside>
}
