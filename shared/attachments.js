const mimeTypes = {
  pdf: 'application/pdf', md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  js: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript',
  py: 'text/x-python', c: 'text/plain', cpp: 'text/plain', cs: 'text/plain', rs: 'text/plain',
  go: 'text/plain', java: 'text/plain', tex: 'text/x-tex', mmd: 'text/plain', mermaid: 'text/plain',
  yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', ini: 'text/plain', log: 'text/plain',
  html: 'text/html', css: 'text/css', xml: 'application/xml', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  aac:'audio/aac',aiff:'audio/aiff',aif:'audio/aiff',wma:'audio/x-ms-wma',opus:'audio/ogg',amr:'audio/amr',ape:'audio/ape',ac3:'audio/ac3',dts:'audio/vnd.dts',mid:'audio/midi',midi:'audio/midi',
  avi:'video/x-msvideo',mkv:'video/x-matroska',wmv:'video/x-ms-wmv',flv:'video/x-flv',mpg:'video/mpeg',mpeg:'video/mpeg',m4v:'video/mp4',mts:'video/mp2t',m2ts:'video/mp2t','3gp':'video/3gpp',vob:'video/mpeg',ogv:'video/ogg',
  glb:'model/gltf-binary',gltf:'model/gltf+json',obj:'model/obj',stl:'model/stl',ply:'application/octet-stream',fbx:'application/octet-stream','3mf':'model/3mf',
}
export const extension = (name = '') => name.includes('.') ? name.split('.').at(-1).toLowerCase() : ''
export const inferMime = (name, mime) => mime && mime !== 'application/octet-stream' ? mime : mimeTypes[extension(name)] || 'application/octet-stream'
export const validEntryPath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4000 &&
  !/[\u0000-\u001f\\]/.test(value) && value.split('/').every((part) => part && part !== '.' && part !== '..' && !part.includes(':'))
export function previewType(name, mime) {
  const type = inferMime(name, mime)
  const ext = extension(name)
  if(['glb','gltf','obj','stl','ply','fbx','3mf'].includes(ext))return 'model'
  if (ext === 'svg') return 'image'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf'
  if (['docx', 'xlsx', 'pptx'].includes(ext)) return 'office'
  if (type.startsWith('text/') || ['application/json', 'application/xml'].includes(type) ||
    ['sh', 'bat', 'ps1', 'sql', 'vue', 'svelte', 'gitignore', 'env', 'lock'].includes(ext)) return 'text'
  return 'binary'
}
export function assetIdsForNote(note) {
  return [...new Set([note.assetId, ...(note.entries || []).map((entry) => entry.assetId)].filter(Boolean))]
}
export function remapNoteAssets(note, ids) {
  return {
    ...note,
    ...(note.assetId ? { assetId: ids.get(note.assetId) ?? note.assetId } : {}),
    ...(note.entries ? { entries: note.entries.map((entry) => ({
      ...entry,
      ...(entry.assetId ? { assetId: ids.get(entry.assetId) ?? entry.assetId } : {}),
    })) } : {}),
  }
}
