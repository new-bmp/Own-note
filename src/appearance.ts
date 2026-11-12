import type { Appearance } from './model'

export const defaultAppearance: Appearance = {
  accent: '#5266d4',
  canvas: '#f6f7fa',
}
export const accentPresets = [
  { name: '工作蓝', color: '#5266d4' },
  { name: '森林绿', color: '#26745c' },
  { name: '暖橙', color: '#b96524' },
  { name: '玫瑰红', color: '#b94768' },
  { name: '紫罗兰', color: '#7952b3' },
  { name: '石墨灰', color: '#526175' },
]
export const canvasPresets = [
  { name: '浅灰', color: '#f6f7fa' },
  { name: '纯白', color: '#ffffff' },
  { name: '米白', color: '#f7f3e9' },
  { name: '雾绿', color: '#edf4ef' },
  { name: '浅蓝', color: '#edf3fb' },
  { name: '深灰', color: '#252c36' },
]
export const cardPresets = [
  { name: '白色', color: '#ffffff' },
  { name: '浅黄', color: '#fff5d9' },
  { name: '浅绿', color: '#eaf5ee' },
  { name: '浅橙', color: '#fff0e9' },
  { name: '浅紫', color: '#edf0ff' },
  { name: '浅蓝', color: '#eaf3fc' },
]

export function validHex(value: string) {
  return /^#[\da-f]{6}$/i.test(value)
}

function rgb(hex: string) {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  )
}

export function mixColor(color: string, target: string, amount: number) {
  const from = rgb(color),
    to = rgb(target)
  return `#${from
    .map((channel, index) =>
      Math.round(channel + (to[index] - channel) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

function luminance(color: string) {
  const channels = rgb(color).map((value) => {
    const channel = value / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

export function textOnColor(color: string) {
  const preferred = contrastRatio('#202938', color) > contrastRatio('#ffffff', color)
    ? '#202938'
    : '#ffffff'
  return readableColor(preferred, color)
}

export function contrastRatio(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

export function readableColor(preferred: string, background: string, minimum = 4.5) {
  if (contrastRatio(preferred, background) >= minimum) return preferred
  const target = contrastRatio('#000000', background) > contrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff'
  for (let step = 1; step <= 100; step++) {
    const color = mixColor(preferred, target, step / 100)
    if (contrastRatio(color, background) >= minimum) return color
  }
  return target
}

export function themeVariables(appearance: Appearance) {
  const accent = validHex(appearance.accent)
    ? appearance.accent
    : defaultAppearance.accent
  const canvas = validHex(appearance.canvas)
    ? appearance.canvas
    : defaultAppearance.canvas
  const soft = mixColor(accent, '#ffffff', 0.92)
  const ink = readableColor(accent, soft)
  const hover = mixColor(accent, '#17202c', 0.1)
  return {
    '--accent': accent,
    '--accent-ink': ink,
    '--accent-soft': soft,
    '--accent-line': mixColor(accent, '#ffffff', 0.67),
    '--accent-on': textOnColor(accent),
    '--accent-hover': hover,
    '--accent-hover-on': textOnColor(hover),
    '--canvas-color': canvas,
    '--canvas-dot': mixColor(canvas, textOnColor(canvas), 0.16),
    '--canvas-ink': readableColor(textOnColor(canvas) === '#ffffff' ? '#cad4e2' : '#5b687c', canvas),
    '--green': ink,
    '--green-dark': ink,
  }
}

export function cardVariables(color: string, accent = defaultAppearance.accent) {
  const background = validHex(color) ? color : '#ffffff'
  const ink = readableColor(textOnColor(background) === '#ffffff' ? '#f5f7fc' : '#303b4d', background)
  const preferredField = mixColor(background, ink, 0.045)
  const field = contrastRatio(ink, preferredField) >= 4.5 ? preferredField : background
  return {
    '--note-color': background,
    '--note-ink': ink,
    '--note-muted': readableColor(mixColor(ink, background, 0.22), field),
    '--note-link': readableColor(validHex(accent) ? accent : defaultAppearance.accent, field),
    '--note-divider': mixColor(background, ink, 0.12),
    '--note-field': field,
  }
}
