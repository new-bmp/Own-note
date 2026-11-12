import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { zipSync, strToU8 } from 'fflate'
import { parseDataset, summarize, filterRows, aggregate, datasetCsv } from '../shared/data-analysis.js'
import { previewType, inferMime } from '../shared/attachments.js'
import { readOffice } from '../src/office-preview.ts'
import { chartFromGrid, chartGrid, clipboardGrid } from '../shared/chart-grid.js'

test('editable data keeps explicit empty rows and chart grids accept Excel paste without requiring JSON',()=>{
  const source=datasetCsv(['类别','数量'],[['甲','3'],['',''],['乙','5'],['','']],false)
  assert.deepEqual(parseDataset(source).rows,[['甲','3'],['',''],['乙','5'],['','']])
  assert.deepEqual(parseDataset('a,b\n\n1,2\n\n').rows,[['1','2']],'accidental blank lines in imported CSV remain ignored')
  const grid=clipboardGrid('类别\t本月\t上月\n甲\t3\t2\n乙\t5\t4')
  const chart=chartFromGrid(grid,'line','小时')
  assert.deepEqual(chart.labels,['甲','乙']);assert.deepEqual(chart.series.map(s=>s.values),[[3,5],[2,4]])
  assert.deepEqual(chartGrid(chart),grid);assert.equal(chart.unit,'小时')
  assert.throws(()=>chartFromGrid([['类别','值'],['甲','']]),/第 1 行/)
  assert.throws(()=>chartFromGrid([['类别','值'],['甲','NaN']]),/有效数值/)
  assert.throws(()=>chartFromGrid([['类别','值'],['','3']]),/类别名称/)
  assert.throws(()=>chartFromGrid(grid,'pie'),/饼图/)
  assert.throws(()=>chartFromGrid([['类别','值'],['甲','0']],'pie'),/饼图/)
  assert.equal(chartFromGrid([['类别','值'],['甲','3'],['乙','5']],'pie').series[0].values[1],5)
})

test('analysis preserves quoted CSV, multiline fields and duplicate headers and handles missing values honestly', () => {
  const data = parseDataset('\ufeff"分,组",值,值 (2),值\r\n"甲\n乙",2,4,\r\n"O""wn",,6,-2\r\n')
  assert.equal(new Set(data.columns).size, 4)
  assert.deepEqual(data.columns, ['分,组', '值', '值 (2)', '值 (3)'])
  assert.equal(data.rows[0][0], '甲\n乙'); assert.equal(data.rows[1][0], 'O"wn')
  const stats = summarize(data.columns, data.rows)
  assert.equal(stats[1].numericCount, 1); assert.equal(stats[1].missing, 1); assert.equal(stats[1].mean, 2)
  assert.equal(stats[2].mean, 5); assert.equal(stats[2].median, 5); assert.ok(Math.abs(stats[2].std - Math.sqrt(2)) < 1e-10)
  assert.deepEqual(parseDataset(datasetCsv(data.columns, data.rows, false)), data)
  assert.throws(() => parseDataset('a,b\n"unfinished'), /未闭合/)
  assert.throws(() => parseDataset('a\n"a"b'), /引号后的字符/)
})

test('JSON, TSV, filtering, grouping and spreadsheet exports produce reproducible values', () => {
  const data = parseDataset('[{"group":"A","amount":2},{"group":"B","amount":5},{"group":"A","amount":4},{"group":"A","amount":null}]', 'json')
  assert.deepEqual(aggregate(data.rows, 0, 1), [{ label: 'A', value: 6 }, { label: 'B', value: 5 }])
  assert.equal(aggregate(data.rows, 0, 1, 'mean').find(v => v.label === 'A').value, 3)
  assert.equal(aggregate(data.rows, 0, 1, 'count').find(v => v.label === 'A').value, 3)
  assert.deepEqual(aggregate([['missing',''],['text','unknown']],0,1,'mean'),[],'missing values are not shown as a measured zero')
  assert.equal(filterRows(data.rows, 1, 'greater', '3').length, 2)
  assert.equal(filterRows(data.rows, 0, 'equals', 'A').length, 3)
  assert.deepEqual(parseDataset('a\tb\n1\t2', 'tsv').rows, [['1', '2']])
  assert.deepEqual(parseDataset('[["x","y"],[1,2]]', 'json').rows, [['1', '2']])
  const safe = datasetCsv(['formula', 'number'], [['=SUM(A1)', '-12'], [' @call()', '3']])
  assert.match(safe, /'=SUM/); assert.match(safe, /' @call/); assert.match(safe, /,-12/)
})

test('Excel analysis reads beyond preview limits and rejects over-wide or uncalculated data', () => {
  globalThis.DOMParser = new JSDOM('').window.DOMParser
  const workbook = (rows) => zipSync(Object.fromEntries(Object.entries({
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="数据" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  }).map(([name, xml]) => [name, strToU8(xml)])))
  const bytes = workbook(Array.from({ length: 1201 }, (_, i) => `<row><c r="A${i + 1}"><v>${i}</v></c></row>`).join(''))
  assert.equal(readOffice(bytes, 'xlsx')[0].rows.length, 1000)
  assert.equal(readOffice(bytes, 'xlsx', { analysis: true })[0].rows.length, 1201)
  assert.throws(() => readOffice(workbook('<row><c r="GS1"><v>1</v></c></row>'), 'xlsx', { analysis: true }), /超过 200 列/)
  assert.throws(() => readOffice(workbook('<row><c r="A1"><f>SUM(A2)</f></c></row>'), 'xlsx', { analysis: true }), /未计算/)
})

test('media and model format routing preserves source TypeScript classification', () => {
  for (const ext of ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', '3mf']) assert.equal(previewType('model.' + ext), 'model')
  for (const ext of ['mp4', 'mkv', 'avi', 'wmv', 'mts', 'vob']) assert.equal(previewType('clip.' + ext), 'video')
  for (const ext of ['mp3', 'flac', 'aiff', 'wma', 'opus']) assert.equal(previewType('sound.' + ext), 'audio')
  assert.equal(inferMime('source.ts'), 'text/typescript'); assert.equal(previewType('source.ts'), 'text')
})
