// Preserve quoted semicolons, comments and trigger bodies when showing each result.
export function splitSql(source) {
  const statements = []
  let start = 0, quote = '', comment = '', token = '', trigger = false, depth = 0
  const words = []
  function word() {
    if (!token) return
    const value = token.toUpperCase()
    words.push(value)
    if (words[0] === 'CREATE' && value === 'TRIGGER' && words.length <= 3) trigger = true
    if (trigger && (value === 'BEGIN' || value === 'CASE')) depth++
    if (trigger && value === 'END') depth--
    token = ''
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1]
    if (comment === 'line') { if (char === '\n') comment = ''; continue }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++ } continue }
    if (quote) {
      if (char === quote) { if (next === quote && quote !== ']') i++; else quote = '' }
      continue
    }
    if (char === '-' && next === '-') { word(); comment = 'line'; i++; continue }
    if (char === '/' && next === '*') { word(); comment = 'block'; i++; continue }
    if (['"', "'", '`', '['].includes(char)) { word(); quote = char === '[' ? ']' : char; continue }
    if (/[\w]/.test(char)) { token += char; continue }
    word()
    if (char === ';' && (!trigger || depth <= 0)) {
      if (words.length) statements.push(source.slice(start, i + 1))
      start = i + 1; words.length = 0; trigger = false; depth = 0
    }
  }
  word()
  if (source.slice(start).trim() && (words.length || quote || comment === 'block')) statements.push(source.slice(start))
  return statements
}

export function sqlProgram(source) {
  return `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
try {
  for (const sql of ${JSON.stringify(splitSql(source))}) {
    const statement = db.prepare(sql);
    console.log(JSON.stringify(statement.columns().length ? statement.all() : statement.run(), (_, value) => typeof value === 'bigint' ? String(value) : value, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db.close(); }
`
}
