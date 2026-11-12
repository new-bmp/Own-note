import test from 'node:test'
import assert from 'node:assert/strict'
import { cardVariables, defaultAppearance, themeVariables, textOnColor } from '../src/appearance.ts'

// Calculate the WCAG ratio independently of the implementation under test.
function ratio(foreground, background) {
  const light = (hex) => {
    const channels = hex.slice(1).match(/../g).map((part) => {
      const value = parseInt(part, 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return channels.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  }
  const a = light(foreground), b = light(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const colors = []
for (let red = 0; red <= 255; red += 17)
  for (let green = 0; green <= 255; green += 17)
    for (let blue = 0; blue <= 255; blue += 17)
      colors.push('#' + [red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join(''))
colors.push('#757575', '#7c7c7c', '#858585', '#fff5d9', '#edf4ef', '#252c36')

test('custom accent buttons, selected labels and canvas hints maintain readable contrast', () => {
  for (const color of colors) {
    const theme = themeVariables({ accent: color, canvas: color })
    for (const background of ['#ffffff', theme['--accent-soft']])
      assert.ok(ratio(theme['--accent-ink'], background) >= 4.5, `accent ${color} on ${background}`)
    assert.ok(ratio(theme['--accent-on'], color) >= 4.5, `button ${color}`)
    assert.ok(ratio(theme['--accent-hover-on'], theme['--accent-hover']) >= 4.5, `hover ${color}`)
    assert.ok(ratio(theme['--canvas-ink'], color) >= 4.5, `canvas ${color}`)
    assert.ok(ratio(textOnColor(color), color) >= 4.5, `swatch ${color}`)
  }
})

test('custom cards keep body, metadata and links readable during display and editing', () => {
  for (const color of colors) {
    const card = cardVariables(color, '#26745c')
    assert.equal(card['--note-color'], color)
    for (const text of ['--note-ink', '--note-muted', '--note-link'])
      for (const background of ['--note-color', '--note-field'])
        assert.ok(ratio(card[text], card[background]) >= 4.5, `${text} ${color} on ${background}`)
  }
  assert.equal(cardVariables('#ffffff', '#26745c')['--note-link'], '#26745c')
})

test('invalid saved colors fall back to readable defaults', () => {
  assert.deepEqual(themeVariables({ accent: '', canvas: '#12' }), themeVariables(defaultAppearance))
  assert.deepEqual(cardVariables('invalid', 'invalid'), cardVariables('#ffffff'))
})
