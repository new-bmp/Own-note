const encode = (value) => value.replace(/["#&<>[\]{}()|\\\s:@`]/g, (char) => `#${char.codePointAt(0)};`)
const decode = (value) => value.replace(/#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
export function diagramSource(graph) {
  const shapes = { box: ['[', ']'], round: ['(', ')'], decision: ['{', '}'] }
  return [
    `flowchart ${graph.direction}`,
    '%% own-builder:v1',
    ...graph.nodes.map((node) => { const [a, b] = shapes[node.shape]; return `  ${node.id}${a}"${encode(node.label)}"${b}` }),
    ...graph.edges.map((edge) => `  ${edge.from} ${edge.dashed ? edge.arrow ? '-.->' : '-.-' : edge.arrow ? '-->' : '---'}${edge.label ? `|"${encode(edge.label)}"|` : ''} ${edge.to}`),
  ].join('\n')
}
export function parseDiagram(source) {
  const lines = source.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const header = lines.shift()?.match(/^flowchart (LR|TB|RL|BT)$/)
  if (!header || !lines.includes('%% own-builder:v1')) return null
  const graph = { direction: header[1], nodes: [], edges: [] }
  for (const line of lines) {
    if (line === '%% own-builder:v1') continue
    const node = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*([\[({])"([^"\r\n]*)"([\])}])$/)
    if (node) {
      const shape = { '[': ['box', ']'], '(': ['round', ')'], '{': ['decision', '}'] }[node[2]]
      if (!shape || node[4] !== shape[1] || graph.nodes.some((item) => item.id === node[1])) return null
      graph.nodes.push({ id: node[1], label: decode(node[3]), shape: shape[0] }); continue
    }
    const edge = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s+(-->|---|-\.->|-\.-)(?:\|"([^"\r\n]*)"\|)?\s+([A-Za-z][A-Za-z0-9_]*)$/)
    if (!edge) return null
    graph.edges.push({ from: edge[1], to: edge[4], label: decode(edge[3] || ''), dashed: edge[2].includes('.'), arrow: edge[2].endsWith('>') })
  }
  if (!graph.nodes.length || graph.nodes.length > 80 || graph.edges.length > 160 ||
    graph.edges.some((edge) => !graph.nodes.some((node) => node.id === edge.from) || !graph.nodes.some((node) => node.id === edge.to))) return null
  // Only switch to forms when no unrecognized Mermaid syntax would be discarded.
  return graph
}
export const diagramTemplates = {
  flow: { direction: 'LR', nodes: [{ id: 'N1', label: '开始', shape: 'round' }, { id: 'N2', label: '处理事项', shape: 'box' }, { id: 'N3', label: '完成', shape: 'round' }], edges: [{ from: 'N1', to: 'N2', label: '', arrow: true, dashed: false }, { from: 'N2', to: 'N3', label: '', arrow: true, dashed: false }] },
  decision: { direction: 'TB', nodes: [{ id: 'N1', label: '待办事项', shape: 'box' }, { id: 'N2', label: '是否通过？', shape: 'decision' }, { id: 'N3', label: '继续执行', shape: 'round' }, { id: 'N4', label: '修改后重试', shape: 'box' }], edges: [{ from: 'N1', to: 'N2', label: '', arrow: true, dashed: false }, { from: 'N2', to: 'N3', label: '是', arrow: true, dashed: false }, { from: 'N2', to: 'N4', label: '否', arrow: true, dashed: false }, { from: 'N4', to: 'N1', label: '', arrow: true, dashed: true }] },
}
