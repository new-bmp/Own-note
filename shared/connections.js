const vectors = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }
export const connectionSides = ['top', 'right', 'bottom', 'left']
export function connectionAnchor(note, side) {
  const [dx, dy] = vectors[side]
  return { x: note.x + note.width / 2 + dx * (note.width / 2 + 5), y: note.y + note.height / 2 + dy * (note.height / 2 + 5) }
}
export function nearestSide(note, point) {
  return connectionSides.reduce((best, side) => {
    const a = connectionAnchor(note, best), b = connectionAnchor(note, side)
    return Math.hypot(point.x - a.x, point.y - a.y) <= Math.hypot(point.x - b.x, point.y - b.y) ? best : side
  }, 'top')
}
function midpoint(points) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let half = lengths.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i] && lengths[i]) {
      const t = half / lengths[i]
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t }
    }
    half -= lengths[i]
  }
  return points[0]
}
export function connectionGeometry(from, to, edge = {}) {
  const center = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 })
  const fromSide = edge.fromSide || nearestSide(from, center(to)), toSide = edge.toSide || nearestSide(to, center(from))
  const a = connectionAnchor(from, fromSide), b = connectionAnchor(to, toSide)
  const style = edge.style || 'curve'
  if (style === 'straight') return { path: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, label: midpoint([a, b]), a, b }
  const distance = Math.max(40, Math.min(180, Math.hypot(b.x - a.x, b.y - a.y) * .4))
  const [fx, fy] = vectors[fromSide], [tx, ty] = vectors[toSide]
  const c = { x: a.x + fx * distance, y: a.y + fy * distance }, d = { x: b.x + tx * distance, y: b.y + ty * distance }
  if (style === 'elbow') {
    const stub = 28
    const p = { x: a.x + fx * stub, y: a.y + fy * stub }, q = { x: b.x + tx * stub, y: b.y + ty * stub }
    const middle = fx && tx ? [{ x: (p.x + q.x) / 2, y: p.y }, { x: (p.x + q.x) / 2, y: q.y }]
      : fy && ty ? [{ x: p.x, y: (p.y + q.y) / 2 }, { x: q.x, y: (p.y + q.y) / 2 }]
        : [fx ? { x: q.x, y: p.y } : { x: p.x, y: q.y }]
    const points = [a, p, ...middle, q, b]
    return { path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '), label: midpoint(points), a, b }
  }
  return { path: `M ${a.x} ${a.y} C ${c.x} ${c.y}, ${d.x} ${d.y}, ${b.x} ${b.y}`, label: { x: (a.x + 3 * c.x + 3 * d.x + b.x) / 8, y: (a.y + 3 * c.y + 3 * d.y + b.y) / 8 }, a, b }
}
