export interface DiagramNode { id: string; label: string; shape: 'box' | 'round' | 'decision' }
export interface DiagramEdge { from: string; to: string; label: string; dashed: boolean; arrow: boolean }
export interface EditableDiagram { direction: 'LR' | 'TB' | 'RL' | 'BT'; nodes: DiagramNode[]; edges: DiagramEdge[] }
export function diagramSource(graph: EditableDiagram): string
export function parseDiagram(source: string): EditableDiagram | null
export const diagramTemplates: Record<'flow' | 'decision', EditableDiagram>
