import { cp, mkdir } from 'node:fs/promises'
const fonts = new URL('../public/mathlive/fonts/', import.meta.url)
await mkdir(fonts, { recursive: true })
await cp(new URL('../node_modules/mathlive/fonts/', import.meta.url), fonts, { recursive: true })
