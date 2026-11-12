import type { CanvasNote } from '../src/model'
export function extension(name?: string): string
export function inferMime(name: string, mime?: string): string
export function validEntryPath(value: unknown): value is string
export function previewType(name: string, mime?: string): 'image' | 'audio' | 'video' | 'pdf' | 'office' | 'text' | 'binary'
export function assetIdsForNote(note: CanvasNote): string[]
export function remapNoteAssets(note: CanvasNote, ids: Map<string, string>): CanvasNote
