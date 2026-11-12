import type { CanvasNote, Connection } from '../src/model'
export type ConnectionSide = 'top' | 'right' | 'bottom' | 'left'
type Point = { x: number; y: number }
type Box = Pick<CanvasNote, 'x' | 'y' | 'width' | 'height'>
export const connectionSides: ConnectionSide[]
export function connectionAnchor(note: Box, side: ConnectionSide): Point
export function nearestSide(note: Box, point: Point): ConnectionSide
export function connectionGeometry(from: Box, to: Box, edge?: Partial<Connection>): { path: string; label: Point; a: Point; b: Point }
