import katex from 'katex'

export const chartColors = [
  '#5266d4',
  '#26745c',
  '#c77a38',
  '#ad5273',
  '#7952b3',
  '#3893ab',
]

export function validChart(chart) {
  return (
    !!chart &&
    ['bar', 'line', 'pie'].includes(chart.type) &&
    Array.isArray(chart.labels) &&
    chart.labels.length > 0 &&
    chart.labels.length <= 60 &&
    chart.labels.every(
      (label) => typeof label === 'string' && label.length <= 120,
    ) &&
    Array.isArray(chart.series) &&
    chart.series.length > 0 &&
    chart.series.length <= 6 &&
    (chart.type !== 'pie' || chart.series.length === 1) &&
    chart.series.every(
      (series) =>
        series &&
        typeof series.name === 'string' &&
        series.name.length > 0 &&
        series.name.length <= 120 &&
        (series.color === undefined || /^#[\da-f]{6}$/i.test(series.color)) &&
        Array.isArray(series.values) &&
        series.values.length === chart.labels.length &&
        series.values.every(
          (value) =>
            Number.isFinite(value) &&
            Math.abs(value) <= 1e15 &&
            (chart.type !== 'pie' || value >= 0),
        ),
    ) &&
    (chart.type !== 'pie' ||
      chart.series[0].values.some((value) => value > 0)) &&
    (chart.unit === undefined ||
      (typeof chart.unit === 'string' && chart.unit.length <= 40))
  )
}

export function validateLatex(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 12000)
    throw new Error('LaTeX 公式需要 1–12000 个字符。')
  return katex.renderToString(source, {
    displayMode: true,
    throwOnError: true,
    trust: false,
    strict: 'ignore',
    maxExpand: 1000,
    maxSize: 20,
    output: 'htmlAndMathml',
  })
}

export function validateDiagramSource(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 20000)
    throw new Error('Mermaid 图源码需要 1–20000 个字符。')
  if (/%%\s*\{|^\s*---/m.test(source))
    throw new Error('请使用纯 Mermaid 源码，配置指令和 frontmatter 不支持。')
  if (
    !/^\s*(?:%%[^\n]*\n\s*)*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|mindmap|timeline|gantt|pie)\b/.test(
      source,
    )
  )
    throw new Error(
      '支持流程图、时序图、类图、状态图、ER 图、思维导图、时间线、甘特图和饼图。',
    )
  if (
    /\b(?:click|href|callback)\s|(?:https?:|javascript:|data:|file:|url\s*\(|@import|<\s*\/?\s*[a-z][^>]*>)/i.test(
      source,
    )
  )
    throw new Error(
      '图中请仅使用文字标签与连接，不包含外部链接、回调、HTML 或嵌入内容。',
    )
}
