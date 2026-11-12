import { useEffect, useRef, useState } from 'react'
import {
  Code2,
  Download,
  GitBranch,
  Sigma,
  ChartColumn,
  FileText,
  X,
  Pencil,
  Bot,
  BookOpen,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import DOMPurify from 'dompurify'
import type { CanvasNote, ChartSpec } from './model'
import {
  chartColors,
  validChart,
  validateDiagramSource,
  validateLatex,
} from '../shared/rich-content.js'
import { downloadFile } from './storage'
import { FormulaInput } from './FormulaInput'
import { DiagramBuilder } from './DiagramBuilder'

export const richKinds = ['markdown', 'latex', 'diagram', 'chart']
export const isRichNote = (note: CanvasNote) => richKinds.includes(note.kind)
const richIcons = {
  markdown: FileText,
  latex: Sigma,
  diagram: GitBranch,
  chart: ChartColumn,
}
const richLabels = {
  markdown: 'Markdown 笔记',
  latex: 'LaTeX 公式',
  diagram: 'Mermaid 图',
  chart: '数据图表',
}
let diagramSequence = 0
let diagramQueue: Promise<unknown> = Promise.resolve()
let mermaidLoader: Promise<(typeof import('mermaid'))['default']> | undefined

function mermaidApi() {
  mermaidLoader ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      fontFamily: 'Inter, Microsoft YaHei, sans-serif',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      maxTextSize: 20000,
      maxEdges: 300,
      suppressErrorRendering: true,
    })
    return mermaid
  })
  return mermaidLoader
}

async function diagramSvg(source: string) {
  validateDiagramSource(source)
  const operation = diagramQueue.then(async () => {
    const mermaid = await mermaidApi()
    const id = `own-diagram-${++diagramSequence}`
    try {
      const { svg } = await mermaid.render(id, source)
      return DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'a', 'image', 'script'],
      })
    } finally {
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
    }
  })
  diagramQueue = operation.catch(() => {})
  return operation
}

export function sourceUrl(value = '') {
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'codex:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="rich-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 },
          ],
        ]}
        urlTransform={(value) => sourceUrl(value)}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) => (
            <a
              href={typeof src === 'string' ? sourceUrl(src) : ''}
              target="_blank"
              rel="noreferrer"
            >
              图片：{alt || '打开图片链接'}
            </a>
          ),
        }}
      >
        {source}
      </Markdown>
    </div>
  )
}

export function Formula({ source }: { source: string }) {
  try {
    return (
      <div
        className="rich-formula"
        dangerouslySetInnerHTML={{ __html: validateLatex(source) }}
      />
    )
  } catch (error) {
    return (
      <div className="rich-error">
        公式待修正：{error instanceof Error ? error.message : '语法无效'}
      </div>
    )
  }
}

export function Diagram({ source }: { source: string }) {
  const [result, setResult] = useState<{ svg?: string; error?: string }>({})
  useEffect(() => {
    let active = true
    setResult({})
    void diagramSvg(source)
      .then((svg) => {
        if (active) setResult({ svg })
      })
      .catch((error) => {
        if (active) setResult({ error: error.message })
      })
    return () => {
      active = false
    }
  }, [source])
  return result.error ? (
    <div className="rich-error">图待修正：{result.error}</div>
  ) : result.svg ? (
    <div
      className="rich-diagram"
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  ) : (
    <div className="rich-loading">正在绘制关系图…</div>
  )
}

const numberLabel = (n: number) =>
  new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
    notation: Math.abs(n) >= 10000 ? 'compact' : 'standard',
  }).format(n)

export function DataChart({
  chart,
  title = '数据图表',
}: {
  chart: ChartSpec
  title?: string
}) {
  const [showData, setShowData] = useState(false)
  if (!validChart(chart))
    return (
      <div className="rich-error">图表数据无效，请检查标签与数值数量。</div>
    )
  const colors = chart.series.map(
    (series, i) => series.color || chartColors[i % chartColors.length],
  )
  const values = chart.series.flatMap((series) => series.values)
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values) || (min === 0 ? 1 : 0)
  const spread = max - min || 1
  const left = 50,
    top = 18,
    width = 400,
    height = 162
  const y = (value: number) => top + ((max - value) / spread) * height
  const step = width / chart.labels.length
  const isPie = chart.type === 'pie'
  const total = values.reduce((a, b) => a + b, 0)
  let angle = -Math.PI / 2
  const visibleLabel = (index: number) =>
    index % Math.max(1, Math.ceil(chart.labels.length / 8)) === 0 ||
    index === chart.labels.length - 1
  return (
    <div className="data-chart">
      <svg
        viewBox="0 0 480 224"
        role="img"
        aria-label={title}
        xmlns="http://www.w3.org/2000/svg"
        style={{ color: 'var(--note-ink, #46536b)' }}
      >
        <title>{title}</title>
        {isPie ? (
          <g>
            {chart.series[0].values.map((value, i) => {
              const start = angle,
                delta = (value / total) * Math.PI * 2
              angle += delta
              const end = angle,
                cx = 240,
                cy = 108,
                radius = 85
              const fill = chartColors[i % chartColors.length]
              const label = `${chart.labels[i]}：${numberLabel(value)}${chart.unit || ''}（${((value / total) * 100).toFixed(1)}%）`
              if (!value) return null
              if (delta >= Math.PI * 2 - 0.00001)
                return (
                  <circle key={i} cx={cx} cy={cy} r={radius} fill={fill}>
                    <title>{label}</title>
                  </circle>
                )
              const d = `M${cx},${cy} L${cx + radius * Math.cos(start)},${cy + radius * Math.sin(start)} A${radius},${radius} 0 ${delta > Math.PI ? 1 : 0},1 ${cx + radius * Math.cos(end)},${cy + radius * Math.sin(end)} Z`
              return (
                <path
                  key={i}
                  d={d}
                  fill={fill}
                  stroke="white"
                  strokeWidth="1.5"
                >
                  <title>{label}</title>
                </path>
              )
            })}
          </g>
        ) : (
          <g>
            {Array.from({ length: 5 }, (_, i) => {
              const value = min + (spread * i) / 4,
                position = top + height - (height * i) / 4
              return (
                <g key={i}>
                  <line
                    x1={left}
                    y1={position}
                    x2={left + width}
                    y2={position}
                    stroke="currentColor"
                    opacity="0.12"
                  />
                  <text
                    x={left - 8}
                    y={position + 4}
                    textAnchor="end"
                    fontSize="12"
                    fill="currentColor"
                  >
                    {numberLabel(value)}
                  </text>
                </g>
              )
            })}
            <line
              x1={left}
              x2={left + width}
              y1={y(0)}
              y2={y(0)}
              stroke="currentColor"
              opacity="0.3"
            />
            {chart.series.map((series, s) => (
              <g key={s}>
                {chart.type === 'line' && (
                  <polyline
                    points={series.values
                      .map(
                        (value, i) => `${left + step * (i + 0.5)},${y(value)}`,
                      )
                      .join(' ')}
                    fill="none"
                    stroke={colors[s]}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                )}
                {series.values.map((value, i) => {
                  const label = `${chart.labels[i]} · ${series.name}：${numberLabel(value)}${chart.unit || ''}`
                  if (chart.type === 'line')
                    return (
                      <circle
                        key={i}
                        cx={left + step * (i + 0.5)}
                        cy={y(value)}
                        r="3"
                        fill={colors[s]}
                      >
                        <title>{label}</title>
                      </circle>
                    )
                  const barWidth = (step * 0.72) / chart.series.length
                  return (
                    <rect
                      key={i}
                      x={left + step * i + step * 0.14 + s * barWidth}
                      y={Math.min(y(0), y(value))}
                      width={Math.max(0.3, barWidth - 1)}
                      height={Math.max(
                        value ? 1 : 0,
                        Math.abs(y(value) - y(0)),
                      )}
                      rx="2"
                      fill={colors[s]}
                    >
                      <title>{label}</title>
                    </rect>
                  )
                })}
              </g>
            ))}
            {chart.labels.map(
              (label, i) =>
                visibleLabel(i) && (
                  <text
                    key={i}
                    x={left + step * (i + 0.5)}
                    y={top + height + 19}
                    textAnchor="middle"
                    fontSize="12"
                    fill="currentColor"
                  >
                    {label.length > 8 ? `${label.slice(0, 7)}…` : label}
                  </text>
                ),
            )}
            {chart.unit && (
              <text x={left} y="11" fontSize="12" fill="currentColor">
                {chart.unit}
              </text>
            )}
          </g>
        )}
      </svg>
      <div className="chart-legend">
        {(isPie ? chart.labels : chart.series.map((s) => s.name)).map(
          (name, i) => (
            <span key={i}>
              <i
                style={{
                  background: isPie
                    ? chartColors[i % chartColors.length]
                    : colors[i],
                }}
              />
              {name}
            </span>
          ),
        )}
      </div>
      <button
        className="chart-data-toggle"
        onClick={() => setShowData((value) => !value)}
        aria-expanded={showData}
      >
        {showData ? '收起数据' : '查看原始数据'}
        {chart.unit ? ` · ${chart.unit}` : ''}
      </button>
      {showData && (
        <div className="chart-data-table">
          <table>
            <thead>
              <tr>
                <th>项目</th>
                {chart.series.map((s, i) => (
                  <th key={i}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.labels.map((label, i) => (
                <tr key={i}>
                  <th>{label}</th>
                  {chart.series.map((s, j) => (
                    <td key={j}>{s.values[i]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function RichPreview({ note }: { note: CanvasNote }) {
  if (note.kind === 'latex') return <Formula source={note.latex || ''} />
  if (note.kind === 'diagram') return <Diagram source={note.mermaid || ''} />
  if (note.kind === 'chart' && note.chart)
    return <DataChart chart={note.chart} title={note.title} />
  return <MarkdownBody source={note.body || ''} />
}

export function SourceBadge({ note }: { note: CanvasNote }) {
  if (!note.source) return null
  const date = new Date(note.source.createdAt).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const url = sourceUrl(note.source.url)
  return (
    <div
      className="note-source"
      title={`会话来源：${note.source.agent || 'Agent'} · ${date}${note.source.conversationId ? ` · ${note.source.conversationId}` : ''}`}
    >
      <Bot size={12} />
      <span>
        {note.source.agent || 'Agent'} 整理 · {date}
      </span>
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          查看来源 ↗
        </a>
      )}
    </div>
  )
}

export function RichCard({
  note,
  onEdit,
  onRead,
  conversation,
}: {
  note: CanvasNote
  onEdit: () => void
  onRead: () => void
  conversation: boolean
}) {
  const content = useRef<HTMLDivElement>(null)
  const kind = note.kind as keyof typeof richLabels
  const Icon = richIcons[kind]
  function exportSvg() {
    const svg = content.current?.querySelector('svg')
    if (svg) {
      const copy = svg.cloneNode(true) as SVGElement
      copy.style.color = '#46536b'
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      downloadFile(
        new Blob([new XMLSerializer().serializeToString(copy)], {
          type: 'image/svg+xml',
        }),
        `${note.title || 'Own 图'}.svg`,
      )
    }
  }
  return (
    <>
      <div className="rich-card-eyebrow">
        <Icon size={14} />
        <span>{note.label || richLabels[kind]}</span>
        <button
          aria-label={`编辑${note.title || richLabels[kind]}`}
          title="编辑内容与源码"
          onClick={onEdit}
        >
          <Pencil size={13} />
        </button>
      </div>
      <h3 className="rich-card-title">{note.title}</h3>
      <div
        className="rich-card-content"
        ref={content}
        data-canvas-ui
        onPointerDown={(event) => event.stopPropagation()}
      >
        <RichPreview note={note} />
        {note.caption && <p className="rich-caption">{note.caption}</p>}
      </div>
      <div className="rich-card-bottom" data-canvas-ui onPointerDown={(event) => event.stopPropagation()}>
        <SourceBadge note={note} />
        {!note.source && <span>双击编辑 · 自由排布</span>}
        <button className="read-note-button" onClick={onRead} title={conversation ? '连续阅读完整会话' : '展开阅读全部内容'}>
          <BookOpen size={13} />{conversation ? '阅读会话' : '阅读全文'}
        </button>
        {['chart', 'diagram'].includes(note.kind) && (
          <button
            onClick={exportSvg}
            title="导出 SVG 图片"
            aria-label={`导出${note.title}为 SVG`}
          >
            <Download size={13} />
          </button>
        )}
      </div>
    </>
  )
}

export function RichEditor({
  note,
  onSave,
  onClose,
}: {
  note: CanvasNote
  onSave: (patch: Partial<CanvasNote>) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(note.title || '')
  const [source, setSource] = useState(
    note.kind === 'chart'
      ? JSON.stringify(note.chart, null, 2)
      : note.latex || note.mermaid || note.body || '',
  )
  const [caption, setCaption] = useState(note.caption || '')
  const [draft, setDraft] = useState(note)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const kind = note.kind as keyof typeof richLabels
  const fieldName =
    note.kind === 'latex'
      ? 'latex'
      : note.kind === 'diagram'
        ? 'mermaid'
        : 'body'
  const hint =
    note.kind === 'latex'
      ? '像写公式一样输入。点击分数、根号等结构，在空位中填写内容。Ctrl + Enter 保存。'
      : note.kind === 'diagram'
        ? '写下节点名称，再选择节点间的关系，右侧实时生成图形。Ctrl + Enter 保存。'
        : note.kind === 'chart'
          ? '编辑 JSON 数据。type 为 bar、line 或 pie；values 与 labels 一一对应。'
          : '支持 Markdown、GFM 表格、行内 $公式$ 和独立 $$公式$$。'
  const patch = (): Partial<CanvasNote> => ({
    title: title.trim(),
    caption,
    ...(note.kind === 'chart'
      ? { chart: JSON.parse(source) as ChartSpec }
      : { [fieldName]: source }),
  })
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setDraft({ ...note, ...patch() })
        setError('')
      } catch {
        setError('JSON 格式无效，请检查逗号、引号和括号。')
      }
    }, 400)
    return () => clearTimeout(timer)
    // The editor opens with a fixed card; source changes drive the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, title, caption])
  async function save() {
    setBusy(true)
    try {
      if (!title.trim()) throw new Error('请填写标题。')
      if (!source.trim()) throw new Error('请填写内容。')
      if (
        source.length >
        (note.kind === 'diagram'
          ? 20000
          : note.kind === 'latex'
            ? 12000
            : 100000)
      )
        throw new Error('内容过长，请拆成多张卡片。')
      const value = patch()
      if (note.kind === 'latex') {
        if (source.includes('\\placeholder')) throw new Error('公式中还有空位，请填写后保存；可以用 Tab 跳到下一个空位。')
        validateLatex(source)
      }
      if (note.kind === 'diagram') await diagramSvg(source)
      if (note.kind === 'chart' && !validChart(value.chart))
        throw new Error(
          '图表数据无效：标签与数值数量须一致，饼图需要一组非负且不全为零的数据。',
        )
      onSave(value)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '内容无效，请检查后重试。',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="modal-overlay rich-editor-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={`modal rich-editor editor-${note.kind}`}
        role="dialog"
        aria-modal="true"
        aria-label={`编辑${richLabels[kind]}`}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !busy) { event.preventDefault(); event.stopPropagation(); void save() } }}
      >
        <header className="rich-editor-header">
          <span>
            <Code2 size={18} />
            {richLabels[kind]}
          </span>
          <button aria-label="关闭编辑器" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <label className="rich-title-label">
          标题
          <input
            autoFocus
            aria-label="卡片标题"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <p className="rich-editor-hint">{hint}</p>
        <div className="rich-editor-columns">
          {note.kind === 'latex' ? <FormulaInput source={source} onChange={setSource} /> : note.kind === 'diagram' ? <DiagramBuilder source={source} onChange={setSource} /> : <label className="rich-source-label">
            {note.kind === 'markdown' ? '正文' : '源码 / 数据'}
            <textarea
              aria-label="卡片源码"
              spellCheck={false}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>}
          <div className="rich-live-preview">
            <span>阅读预览</span>
            <div>
              <RichPreview note={draft} />
              {draft.caption && <p className="rich-caption">{draft.caption}</p>}
            </div>
          </div>
        </div>
        {note.kind !== 'markdown' && (
          <label className="rich-caption-label">
            说明、单位与来源
            <textarea
              aria-label="卡片说明"
              maxLength={4000}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="用通俗语言解释公式或图的含义，让读者知道结论与依据。"
            />
          </label>
        )}
        {error && (
          <div className="rich-error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <button className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={busy || !title.trim() || !source.trim()}
            onClick={() => void save()}
          >
            {busy ? '正在校验…' : '保存卡片'}
          </button>
        </footer>
      </section>
    </div>
  )
}
