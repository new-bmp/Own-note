import { useEffect, useState } from 'react'
import { Check, ChevronDown, Palette, RotateCcw, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Appearance } from './model'
import {
  accentPresets,
  canvasPresets,
  cardPresets,
  defaultAppearance,
  textOnColor,
  validHex,
} from './appearance'

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [hex, setHex] = useState(value.toUpperCase())
  useEffect(() => setHex(value.toUpperCase()), [value])
  return (
    <div className="custom-color-field">
      <label
        className="native-color-picker"
        style={{ '--picker-color': value } as CSSProperties}
      >
        <input
          type="color"
          aria-label={`${label}选择器`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span aria-hidden="true" />
        <ChevronDown size={12} aria-hidden="true" />
      </label>
      <input
        className="color-hex-input"
        aria-label={`${label}十六进制值`}
        aria-invalid={!validHex(hex)}
        spellCheck={false}
        maxLength={7}
        value={hex}
        onChange={(event) => {
          const next = event.target.value
          setHex(next)
          if (validHex(next)) onChange(next.toLowerCase())
        }}
        onBlur={() => {
          if (!validHex(hex)) setHex(value.toUpperCase())
        }}
      />
    </div>
  )
}

export function AppearanceSettings({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: Appearance
  onChange: (value: Appearance) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <>
      <span className="modal-illustration appearance-illustration">
        <Palette size={25} />
      </span>
      <span className="eyebrow">APPEARANCE</span>
      <h2>让工作空间，合你心意。</h2>
      <p>调整主题和画布颜色，实时查看效果。</p>
      <section className="appearance-section" aria-label="主题色设置">
        <div className="appearance-section-title">
          <strong>主题色</strong>
          <span>按钮、选中状态与进度</span>
        </div>
        <div className="accent-presets">
          {accentPresets.map((preset) => (
            <button
              key={preset.color}
              type="button"
              aria-label={`主题色：${preset.name}`}
              aria-pressed={value.accent === preset.color}
              className={value.accent === preset.color ? 'selected' : ''}
              onClick={() => onChange({ ...value, accent: preset.color })}
            >
              <span
                style={{
                  background: preset.color,
                  color: textOnColor(preset.color),
                }}
              >
                {value.accent === preset.color && <Check size={17} />}
              </span>
              <small>{preset.name}</small>
            </button>
          ))}
        </div>
        <div className="appearance-custom-row">
          <span>自定义主题色</span>
          <ColorField
            label="主题色"
            value={value.accent}
            onChange={(accent) => onChange({ ...value, accent })}
          />
        </div>
      </section>
      <section className="appearance-section" aria-label="画布背景设置">
        <div className="appearance-section-title">
          <strong>画布背景</strong>
          <span>为内容留一块舒适的底色</span>
        </div>
        <div className="canvas-presets">
          {canvasPresets.map((preset) => (
            <button
              type="button"
              key={preset.color}
              aria-label={`画布背景：${preset.name}`}
              aria-pressed={value.canvas === preset.color}
              className={value.canvas === preset.color ? 'selected' : ''}
              onClick={() => onChange({ ...value, canvas: preset.color })}
            >
              <span
                style={{
                  background: preset.color,
                  color: textOnColor(preset.color),
                }}
              >
                {value.canvas === preset.color && <Check size={15} />}
              </span>
              <small>{preset.name}</small>
            </button>
          ))}
        </div>
        <div className="appearance-custom-row">
          <span>自定义背景</span>
          <ColorField
            label="画布背景"
            value={value.canvas}
            onChange={(canvas) => onChange({ ...value, canvas })}
          />
        </div>
      </section>
      <div className="appearance-hint">
        单张卡片的颜色，可选中卡片后点击调色图标修改。
      </div>
      <div className="appearance-actions">
        <button
          type="button"
          className="appearance-reset"
          onClick={() => onChange({ ...defaultAppearance })}
        >
          <RotateCcw size={13} />
          恢复默认
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="primary-button" onClick={onSave}>
          保存配色
          <Check size={14} />
        </button>
      </div>
    </>
  )
}

export function CardColorMenu({
  color,
  defaultColor,
  onChange,
}: {
  color?: string
  defaultColor: string
  onChange: (color: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(
    color && validHex(color) ? color : defaultColor,
  )
  return (
    <div className="card-color-control">
      <button
        className={`icon-button ${open ? 'is-active' : ''}`}
        aria-label="卡片颜色"
        title="卡片颜色"
        aria-expanded={open}
        onClick={() => {
          setDraft(color && validHex(color) ? color : defaultColor)
          setOpen(!open)
        }}
      >
        <Palette size={14} />
      </button>
      {open && (
        <div
          className="card-color-menu"
          role="dialog"
          aria-label="卡片颜色设置"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setOpen(false)
            }
          }}
        >
          <div className="card-color-heading">
            <strong>卡片颜色</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭卡片颜色设置"
              onClick={() => setOpen(false)}
            >
              <X size={13} />
            </button>
          </div>
          <div className="card-color-presets">
            {cardPresets.map((preset) => (
              <button
                key={preset.color}
                type="button"
                title={preset.name}
                aria-label={`卡片颜色：${preset.name}`}
                aria-pressed={draft === preset.color}
                style={{
                  background: preset.color,
                  color: textOnColor(preset.color),
                }}
                onClick={() => setDraft(preset.color)}
              >
                {draft === preset.color && <Check size={13} />}
              </button>
            ))}
          </div>
          <ColorField label="卡片颜色" value={draft} onChange={setDraft} />
          <div className="card-color-actions">
            <button
              type="button"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              恢复默认
            </button>
            <button
              type="button"
              className="apply-card-color"
              onClick={() => {
                onChange(draft)
                setOpen(false)
              }}
            >
              应用颜色
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
