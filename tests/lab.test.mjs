import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpeg from 'ffmpeg-static'
import { createFieldnotesServer } from '../server.mjs'
import { initialNotebook, makeNote } from '../src/model.ts'
import { validNotebook } from '../shared/validation.js'
import { splitSql } from '../services/sql.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'own-lab-test-'))
  const server = await createFieldnotesServer({ dataDir })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    assert.equal(path.dirname(dataDir), path.resolve(tmpdir()))
    assert.ok(path.basename(dataDir).startsWith('own-lab-test-'))
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  const request = (route, options) => fetch(url + route, options)
  const start = async (route, body) => {
    const response = await request('/api/lab/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal(response.status, 202, await response.clone().text()); return response.json()
  }
  const get = async id => (await request(`/api/lab/jobs/${id}`)).json()
  const wait = async id => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { const job = await get(id); if (job.status !== 'running') return job; await pause(30) }
    assert.fail('Job did not finish in 15 seconds')
  }
  return { request, start, get, wait, dataDir }
}

test('code jobs stream actual stdout, accept stdin, preserve errors and run TypeScript and multi-statement SQL', async t => {
  const app = await fixture(t)
  const job = await app.start('code', { language: 'javascript', stdin: '3 5 8', code: String.raw`let input=''; for await (const part of process.stdin) input+=part; console.log('started'); await new Promise(r=>setTimeout(r,1200)); console.log(input.trim().split(/\s+/).map(Number).reduce((a,b)=>a+b,0));` })
  let streamed = false
  for (let i = 0; i < 100; i++) { const progress = await app.get(job.id); if (progress.status === 'running' && progress.stdout.includes('started')) { streamed = true; break } if (progress.status !== 'running') break; await pause(20) }
  assert.ok(streamed, 'stdout must be observable while the process still runs')
  const done = await app.wait(job.id)
  assert.equal(done.status, 'success'); assert.equal(done.stdout, 'started\n16\n'); assert.equal(done.exitCode, 0)
  const ts = await app.wait((await app.start('code', { language: 'typescript', stdin: '', code: 'const square = (n: number): number => n*n; console.log(square(12));' })).id)
  assert.equal(ts.stdout, '144\n'); assert.equal(ts.status, 'success')
  const failed = await app.wait((await app.start('code', { language: 'javascript', stdin: '', code: 'console.log("before error"); throw new Error("expected-failure");' })).id)
  assert.equal(failed.status, 'error'); assert.equal(failed.stdout, 'before error\n'); assert.match(failed.stderr, /expected-failure/)
  const sql = `-- comments may contain ; and '
CREATE TABLE items (label TEXT, amount REAL);
CREATE TABLE audit (message TEXT);
CREATE TRIGGER audit_item AFTER INSERT ON items BEGIN
 INSERT INTO audit VALUES (CASE WHEN NEW.amount > 0 THEN 'positive; value' ELSE 'other' END);
 INSERT INTO audit VALUES ('second');
END;
INSERT INTO items VALUES ('Own; note', 12), ('O''Brien', 8);
/* another ; comment */ SELECT SUM(amount) AS total FROM items;
SELECT message FROM audit; -- trailing ; comment`
  assert.equal(splitSql(sql).length, 6)
  const query = await app.wait((await app.start('code', { language: 'sql', stdin: '', code: sql })).id)
  assert.equal(query.status, 'success', query.stderr); assert.match(query.stdout, /"total": 20/); assert.match(query.stdout, /positive; value/)
  const fresh = await app.wait((await app.start('code', { language: 'sql', stdin: '', code: 'SELECT * FROM items;' })).id)
  assert.equal(fresh.status, 'error'); assert.match(fresh.stderr, /no such table/)
})

test('timeouts, cancellation before spawning and output limits stop code and release capacity', async t => {
  const app = await fixture(t)
  const slow = await app.start('code', { language: 'javascript', stdin: '', code: 'setInterval(()=>{},1000)', timeoutMs: 1000 })
  const timeout = await app.wait(slow.id)
  assert.equal(timeout.status, 'stopped'); assert.match(timeout.reason, /超时/)
  const cancelled = await app.start('code', { language: 'javascript', stdin: '', code: 'setInterval(()=>console.log("tick"),100)' })
  assert.equal((await app.request(`/api/lab/jobs/${cancelled.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await app.wait(cancelled.id)).status, 'stopped')
  const large = await app.wait((await app.start('code', { language: 'javascript', stdin: '', code: 'while(true) console.log("X".repeat(4096));' })).id)
  assert.equal(large.status, 'stopped'); assert.equal(large.truncated, true); assert.ok(large.stdout.length + large.stderr.length <= 262144)
  for (const body of [null, { language: 'shell', code: 'echo test', stdin: '' }, { language: 'javascript', code: 'x'.repeat(100001), stdin: '' }]) {
    assert.equal((await app.request('/api/lab/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400)
  }
  assert.equal((await app.request('/api/lab/runtimes', { headers: { Origin: 'https://elsewhere.example' } })).status, 403)
  const capabilities = await (await app.request('/api/lab/runtimes')).json()
  assert.ok(capabilities.languages.find(item => item.id === 'javascript').available)
  assert.ok(capabilities.languages.find(item => item.id === 'python'))
  assert.equal(capabilities.mediaConversion, true)
})

export function wave(seconds = 1) {
  const rate = 8000, samples = rate * seconds, bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 440 * Math.PI * 2 / rate) * 4000), 44 + i * 2)
  return bytes
}

test('bundled FFmpeg converts original attachments to playable media with seekable HTTP ranges', async t => {
  const app = await fixture(t), original = wave()
  assert.equal((await app.request('/api/assets/wave', { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: original })).status, 200)
  const audio = await app.wait((await app.start('convert', { assetId: 'wave', type: 'audio' })).id)
  assert.equal(audio.status, 'success', audio.stderr); assert.match(audio.url, /\.mp3$/)
  const full = await app.request(audio.url), mp3 = Buffer.from(await full.arrayBuffer())
  assert.match(full.headers.get('content-type'), /^audio\/mpeg/); assert.ok(mp3.length > 1000)
  const ranged = await app.request(audio.url, { headers: { Range: 'bytes=0-63' } })
  assert.equal(ranged.status, 206); assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), mp3.subarray(0, 64))
  const suffix=await app.request(audio.url,{headers:{Range:'bytes=-32'}})
  assert.equal(suffix.status,206);assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),mp3.subarray(-32))
  assert.equal((await app.request(audio.url, { method: 'HEAD' })).headers.get('content-length'), String(mp3.length))
  assert.equal((await app.request(audio.url, { headers: { Range: 'bytes=999999999-' } })).status, 416)
  assert.deepEqual(Buffer.from(await (await app.request('/api/assets/wave')).arrayBuffer()), original)
  const fixtureFile = path.join(app.dataDir, 'test.avi')
  await promisify(execFile)(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5', '-t', '1', '-c:v', 'mpeg4', fixtureFile], { windowsHide: true })
  await app.request('/api/assets/avi', { method: 'PUT', headers: { 'Content-Type': 'video/x-msvideo' }, body: await readFile(fixtureFile) })
  const video = await app.wait((await app.start('convert', { assetId: 'avi', type: 'video' })).id)
  assert.equal(video.status, 'success', video.stderr)
  const mp4 = Buffer.from(await (await app.request(video.url)).arrayBuffer())
  assert.equal(mp4.toString('ascii', 4, 8), 'ftyp')
  await app.request('/api/assets/bad-media', { method: 'PUT', body: Buffer.from('not media') })
  const bad = await app.wait((await app.start('convert', { assetId: 'bad-media', type: 'video' })).id)
  assert.equal(bad.status, 'error'); assert.ok(bad.stderr); assert.equal(bad.url, undefined)
  assert.equal((await app.request('/api/lab/convert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: '../notebook', type: 'video' }) })).status, 400)
})

test('new notebook fields persist and reject invalid cell, analysis and task metadata', () => {
  const notebook = initialNotebook(), notes = notebook.boards[0].notes
  const code = makeNote('code', 10, 10), analysis = makeNote('analysis', 20, 20), concept = makeNote('concept', 30, 30)
  notes.push(code, analysis, concept)
  code.cells[0].executedLanguage = 'javascript'; code.cells[0].executedInput = code.cells[0].stdin; code.cells[0].output = '16\n'
  analysis.analysisSettings = { filter: { column: 1, operator: 'equals', value: '研发' }, group: 1, value: 2, method: 'sum', chartType: 'bar' }
  assert.ok(validNotebook(notebook)); assert.deepEqual(JSON.parse(JSON.stringify(notebook)).boards[0].notes.at(-3).cells, code.cells)
  for (const mutate of [n => n.cells.push(n.cells[0]), n => n.cells[0].stdin = 'x'.repeat(64001), n => n.cells[0].executedInput = 10]) {
    const invalid = structuredClone(notebook); mutate(invalid.boards[0].notes.at(-3)); assert.equal(validNotebook(invalid), false)
  }
  const invalid = structuredClone(notebook); invalid.boards[0].notes.at(-2).analysisSettings.filter.column = 1000
  assert.equal(validNotebook(invalid), false)
  const badConcept = structuredClone(notebook); badConcept.boards[0].notes.at(-1).concept.dependsOn = 5
  assert.equal(validNotebook(badConcept), false)
})
