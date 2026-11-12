import { useEffect, useRef, useState } from 'react'
import type { MathfieldElement } from 'mathlive'
const structures = [
  ['分数', '\\frac{#?}{#?}'], ['上标', '#0^{#?}'], ['下标', '#0_{#?}'], ['根号', '\\sqrt{#?}'],
  ['求和 ∑', '\\sum_{#?}^{#?}'], ['积分 ∫', '\\int_{#?}^{#?}#?\\,dx'], ['极限', '\\lim_{#?\\to#?}'],
  ['矩阵', '\\begin{pmatrix}#? & #? \\\\ #? & #?\\end{pmatrix}'], ['括号', '\\left(#?\\right)'],
  ['α', '\\alpha'], ['β', '\\beta'], ['π', '\\pi'], ['θ', '\\theta'], ['∞', '\\infty'], ['≈', '\\approx'], ['≤', '\\le'], ['×', '\\times'],
]
const examples = [
  ['二次方程', 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}'],
  ['加权平均', '\\bar{x}=\\frac{\\sum_{i=1}^{n}w_i x_i}{\\sum_{i=1}^{n}w_i}'],
  ['矩阵', 'A=\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}'],
]
export function FormulaInput({ source, onChange }: { source: string; onChange: (value: string) => void }) {
  const host = useRef<HTMLDivElement>(null), field = useRef<MathfieldElement | null>(null)
  const keyboard = useRef<HTMLDivElement>(null)
  const change = useRef(onChange), value = useRef(source)
  change.current = onChange; value.current = source
  const [raw, setRaw] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void import('mathlive').then(({ MathfieldElement }) => {
      if (!active || !host.current) return
      MathfieldElement.fontsDirectory = '/mathlive/fonts'
      MathfieldElement.soundsDirectory = null
      MathfieldElement.locale = 'zh-cn'
      const input = new MathfieldElement()
      input.value = value.current
      input.mathVirtualKeyboardPolicy = 'manual'
      input.setAttribute('aria-label', '可视公式输入')
      input.setAttribute('placeholder', '在这里输入公式，或点击上方结构')
      input.tabIndex = 0
      input.addEventListener('input', () => change.current(input.getValue('latex')))
      host.current.append(input); field.current = input
      window.mathVirtualKeyboard.container = keyboard.current
      setReady(true)
    }).catch(() => { if (active) { setError('可视输入器暂时无法载入，可继续编辑 LaTeX 源码。'); setRaw(true) } })
    return () => { active = false; window.mathVirtualKeyboard?.hide(); if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.container = null; field.current?.remove(); field.current = null }
  }, [])
  useEffect(() => { if (field.current && field.current.value !== source) field.current.setValue(source, { silenceNotifications: true }) }, [source])
  useEffect(() => { if (raw) window.mathVirtualKeyboard?.hide() }, [raw])
  return <div className="formula-input">
    <div className="editor-mode-tabs"><button className={!raw ? 'active' : ''} onClick={() => setRaw(false)}>可视输入</button><button className={raw ? 'active' : ''} onClick={() => setRaw(true)}>LaTeX 源码</button></div>
    <div className="formula-structures" aria-label="公式结构">{structures.map(([label, latex]) => <button key={label} disabled={!ready} title={`插入${label}`} onPointerDown={(event) => event.preventDefault()} onClick={() => { setRaw(false); field.current?.focus(); field.current?.insert(latex, { selectionMode: 'placeholder' }) }}>{label}</button>)}</div>
    <div ref={host} className={`mathfield-host ${raw ? 'mathfield-hidden' : ''}`} />
    {!ready && !error && <p className="authoring-help">正在载入公式输入器…</p>}
    {error && <p className="rich-error" role="alert">{error}</p>}
    {raw && <textarea className="formula-source" aria-label="LaTeX 源码" spellCheck={false} value={source} onChange={(event) => onChange(event.target.value)} />}
    <p className="authoring-help">直接输入数字和字母；用方向键移动，Tab 跳到下一个空位。输入 / 可建立分数，^ 输入上标，_ 输入下标。</p>
    <button className="secondary-button formula-keyboard" disabled={!ready} onPointerDown={(event) => event.preventDefault()} onClick={() => { setRaw(false); field.current?.focus(); window.mathVirtualKeyboard?.show() }}>打开数学键盘</button>
    <div ref={keyboard} className="formula-keyboard-host" />
    <div className="formula-examples"><span>从示例开始</span>{examples.map(([label, latex]) => <button key={label} onClick={() => onChange(latex)}>{label}</button>)}</div>
  </div>
}
