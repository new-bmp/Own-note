import { unzipSync, strFromU8 } from 'fflate'

export interface DocumentPart { title?: string; text?: string; rows?: string[][] }
export function readOffice(bytes: Uint8Array, extension: string, options: { analysis?: boolean } = {}): DocumentPart[] {
  let total = 0
  const files = unzipSync(bytes, { filter: (file) => {
    const wanted = /^(word\/document\.xml|xl\/(workbook\.xml|_rels\/workbook.xml.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)|ppt\/slides\/slide\d+\.xml)$/.test(file.name)
    if (!wanted) return false
    total += file.originalSize
    if (file.originalSize > 8_000_000 || total > 20_000_000) throw new Error('文档内容较大，请另存后用桌面软件打开。')
    return true
  } })
  const parse = (name: string) => {
    const xml = files[name]
    if (!xml) throw new Error('文档结构无法识别，请使用原始文件打开。')
    const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error('文档内容无法解析。')
    return doc
  }
  const elements = (node: Document | Element, local: string) => Array.from(node.getElementsByTagNameNS('*', local))
  const texts = (node: Document | Element) => elements(node, 't').map((node) => node.textContent || '').join('')
  if (extension === 'docx') {
    const body = elements(parse('word/document.xml'), 'body')[0]
    if (!body) throw new Error('文档中没有正文。')
    return Array.from(body.children).map((node): DocumentPart => node.localName === 'tbl' ? {
      rows: elements(node, 'tr').map((row) => Array.from(row.children).filter((cell) => cell.localName === 'tc').map(texts)),
    } : { text: elements(node, 'p').map(texts).join('\n') || texts(node) })
  }
  if (extension === 'pptx') return Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]))
    .map((name, index) => ({ title: `第 ${index + 1} 页`, text: elements(parse(name), 'p').map(texts).join('\n') }))
  const strings = files['xl/sharedStrings.xml'] ? elements(parse('xl/sharedStrings.xml'), 'si').map(texts) : []
  const workbook = parse('xl/workbook.xml')
  const relations = new Map(elements(parse('xl/_rels/workbook.xml.rels'), 'Relationship').map((node) => [node.getAttribute('Id'), node.getAttribute('Target') || '']))
  return elements(workbook, 'sheet').slice(0, 30).map((sheet) => {
    const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const target = relations.get(id) || ''
    const name = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) return { title: sheet.getAttribute('name') || '工作表', text: '此工作表请使用原始文件查看。' }
    const sourceRows = elements(parse(name), 'row')
    if (options.analysis && sourceRows.length > 50001) throw new Error('Excel 超过 50000 行数据，请缩小范围后再分析。')
    const rows = sourceRows.slice(0, options.analysis ? 50001 : 1000).map((row) => {
      const cells: string[] = []
      for (const cell of elements(row, 'c')) {
        const ref = cell.getAttribute('r')?.match(/^[A-Z]+/)?.[0] || 'A'
        const index = [...ref].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1
        if (index >= 200) {
          if (options.analysis) throw new Error('Excel 超过 200 列，请缩小范围后再分析。')
          continue
        }
        if (options.analysis && elements(cell, 'f').length && !elements(cell, 'v').length)
          throw new Error('Excel 含有未计算的公式，请在 Excel 中计算并保存，或导出 CSV 后再导入。')
        const value = elements(cell, 'v')[0]?.textContent || ''
        cells[index] = cell.getAttribute('t') === 's' ? strings[Number(value)] || '' : cell.getAttribute('t') === 'inlineStr' ? texts(cell) : value
      }
      return Array.from({ length: cells.length }, (_, index) => cells[index] || '')
    })
    return { title: `${sheet.getAttribute('name') || '工作表'}${options.analysis ? '' : ' · 预览最多 1000 行、200 列'}`, rows }
  })
}
