import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { hoursBetween, csvEscape } from './public/calc.js'

const env = process.env
const PORT = Number(env.PORT) || 8080
const DB_PATH = env.DB_PATH || 'data/swk.db'
const SECURE = env.SECURE_COOKIES === '1'
const TZ = 'Asia/Dubai'
const SESSION_MS = 14 * 864e5
const PUBLIC = path.resolve('public')

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN('manager','staff')),
  pw TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, repeat TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS days(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, in_at TEXT, out_at TEXT, loc TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', tasks TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(user_id,date));`)

// ---- passwords: scrypt, stored as salt:hash (hex)
const hashPw = pw => { const s = crypto.randomBytes(16); return `${s.toString('hex')}:${crypto.scryptSync(pw, s, 64).toString('hex')}` }
const checkPw = (pw, stored) => {
  const [s, h] = stored.split(':'); const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
const DUMMY = hashPw('x') // equalises timing for unknown emails
const PW_MIN = 10
const sha = t => crypto.createHash('sha256').update(t).digest('hex')
const dubaiDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

// ---- first-run manager
if (!db.prepare('SELECT 1 FROM users').get()) {
  const { SWK_ADMIN_EMAIL: e, SWK_ADMIN_PASSWORD: p } = env
  if (!e || !p || p.length < PW_MIN) { console.error(`No users yet. Set SWK_ADMIN_EMAIL and SWK_ADMIN_PASSWORD (min ${PW_MIN} chars) to create the first manager.`); process.exit(1) }
  db.prepare('INSERT INTO users(email,name,role,pw) VALUES(?,?,?,?)').run(e.trim().toLowerCase(), env.SWK_ADMIN_NAME || 'Manager', 'manager', hashPw(p))
  console.log('Created first manager', e)
}

// ---- helpers
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status } }
const bad = (m, s = 400) => { throw new HttpError(s, m) }
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)) }
const SEC = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" }
const readBody = req => new Promise((ok, no) => {
  let n = 0; const c = []
  req.on('data', b => { n += b.length; if (n > 1e5) { no(new HttpError(413, 'Too large')); req.destroy() } else c.push(b) })
  req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c)) : {}) } catch { no(new HttpError(400, 'Bad JSON')) } })
})
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)] }))
const str = (v, max, name) => { if (typeof v !== 'string' || !v.trim() || v.length > max) bad(`${name} required (max ${max} chars)`); return v.trim() }
const monthOf = q => { const m = q || dubaiDay().slice(0, 7); if (!/^\d{4}-\d{2}$/.test(m)) bad('Bad month'); return m }

const login = new Map() // shortcut: in-memory throttle resets on restart; move to DB if running several instances
function throttle(key) {
  const r = login.get(key)
  if (r && r.until > Date.now()) bad('Too many attempts. Try again in 15 minutes.', 429)
}
function fail(key) {
  const r = login.get(key) || { n: 0, until: 0 }; r.n++
  if (r.n >= 5) { r.until = Date.now() + 15 * 6e4; r.n = 0 }
  login.set(key, r)
}

const pub = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active, must_change: !!u.must_change })
const me = u => ({ ...pub(u), repeat: JSON.parse(u.repeat) })
const dayRow = r => r && ({ date: r.date, in: r.in_at, out: r.out_at, loc: r.loc, note: r.note, tasks: JSON.parse(r.tasks) })

function todayRow(u) {
  const date = dubaiDay()
  db.prepare('INSERT OR IGNORE INTO days(user_id,date,tasks) VALUES(?,?,?)').run(u.id, date, JSON.stringify(JSON.parse(u.repeat).map(text => ({ text, done: false }))))
  return db.prepare('SELECT * FROM days WHERE user_id=? AND date=?').get(u.id, date)
}
function cleanTasks(t) {
  if (!Array.isArray(t) || t.length > 50) bad('Tasks must be a list of at most 50')
  return t.map(x => ({ text: str(x?.text, 200, 'Task text'), done: x.done === true }))
}

// ---- manager reports
function monthRows(month) {
  return db.prepare(`SELECT u.id uid, u.name, u.email, d.* FROM days d JOIN users u ON u.id=d.user_id WHERE d.date LIKE ? ORDER BY u.name, d.date`).all(month + '-%')
}
const hours = r => (r.in_at && r.out_at ? hoursBetween(r.in_at, r.out_at) : 0)

// ---- routes
const routes = []
const route = (method, pattern, role, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), role, fn })
const pwOk = p => typeof p === 'string' && p.length >= PW_MIN && p.length <= 200 || bad(`Password must be ${PW_MIN}-200 characters`)

route('POST', '/api/login', null, async (req, res, _u, _m, body) => {
  const email = String(body.email || '').trim().toLowerCase(), key = `${req.socket.remoteAddress}|${email}`
  throttle(key)
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email)
  const ok = checkPw(String(body.password || ''), u ? u.pw : DUMMY) && u && u.active
  if (!ok) { fail(key); bad('Wrong email or password', 401) }
  login.delete(key)
  const token = crypto.randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(sha(token), u.id, Date.now() + SESSION_MS)
  json(res, 200, me(u), { 'set-cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${SECURE ? '; Secure' : ''}` })
})
route('POST', '/api/logout', 'any', (req, res, u) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(sha(cookie(req).sid || ''))
  json(res, 200, { ok: true }, { 'set-cookie': `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}` })
})
route('GET', '/api/me', 'any', (_q, res, u) => json(res, 200, me(u)))
route('POST', '/api/password', 'any', (req, res, u, _m, b) => {
  if (!checkPw(String(b.current || ''), u.pw)) bad('Current password is wrong', 403)
  pwOk(b.next); if (b.next === b.current) bad('Choose a different password')
  db.prepare('UPDATE users SET pw=?, must_change=0 WHERE id=?').run(hashPw(b.next), u.id)
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(u.id, sha(cookie(req).sid)) // sign out other devices
  json(res, 200, { ok: true })
})
route('PUT', '/api/repeat', 'any', (_q, res, u, _m, b) => {
  const r = cleanTasks((b.repeat || []).map(text => ({ text }))).map(t => t.text)
  db.prepare('UPDATE users SET repeat=? WHERE id=?').run(JSON.stringify(r), u.id); json(res, 200, { repeat: r })
})
route('GET', '/api/day', 'any', (_q, res, u) => json(res, 200, dayRow(todayRow(u))))
route('PUT', '/api/day', 'any', (_q, res, u, _m, b) => {
  const d = todayRow(u), note = typeof b.note === 'string' && b.note.length <= 2000 ? b.note : bad('Note too long (max 2000)')
  db.prepare('UPDATE days SET tasks=?, note=? WHERE user_id=? AND date=?').run(JSON.stringify(cleanTasks(b.tasks)), note, u.id, d.date)
  json(res, 200, dayRow(db.prepare('SELECT * FROM days WHERE user_id=? AND date=?').get(u.id, d.date)))
})
route('POST', '/api/punch', 'any', (_q, res, u, _m, b) => {
  const d = todayRow(u), now = new Date().toISOString() // server clock is the source of truth
  if (b.action === 'in') { if (d.in_at) bad('Already checked in', 409); db.prepare('UPDATE days SET in_at=?, loc=? WHERE user_id=? AND date=?').run(now, /^-?\d+\.\d+,-?\d+\.\d+$/.test(b.loc || '') ? b.loc : '', u.id, d.date) }
  else if (b.action === 'out') { if (!d.in_at) bad('Check in first', 409); if (d.out_at) bad('Already checked out', 409); db.prepare('UPDATE days SET out_at=? WHERE user_id=? AND date=?').run(now, u.id, d.date) }
  else if (b.action === 'undo') { db.prepare('UPDATE days SET out_at=NULL WHERE user_id=? AND date=?').run(u.id, d.date) }
  else bad('Unknown action')
  json(res, 200, dayRow(db.prepare('SELECT * FROM days WHERE user_id=? AND date=?').get(u.id, d.date)))
})
route('GET', '/api/days', 'any', (req, res, u, _m, _b, q) => {
  const month = monthOf(q.get('month'))
  const months = db.prepare(`SELECT DISTINCT substr(date,1,7) m FROM days WHERE user_id=? AND in_at IS NOT NULL ORDER BY m DESC`).all(u.id).map(r => r.m)
  json(res, 200, { month, months, rows: db.prepare('SELECT * FROM days WHERE user_id=? AND date LIKE ? ORDER BY date').all(u.id, month + '-%').map(dayRow) })
})

route('GET', '/api/team/today', 'manager', (_q, res) => {
  const date = dubaiDay()
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.role,d.in_at,d.out_at,d.loc,d.note,d.tasks FROM users u LEFT JOIN days d ON d.user_id=u.id AND d.date=? WHERE u.active=1 ORDER BY u.name`).all(date)
  json(res, 200, { date, rows: rows.map(r => { const t = r.tasks ? JSON.parse(r.tasks) : []; return { id: r.id, name: r.name, email: r.email, role: r.role, in: r.in_at, out: r.out_at, loc: r.loc, note: r.note, done: t.filter(x => x.done).length, total: t.length } }) })
})
route('GET', '/api/team/report', 'manager', (_q, res, _u, _m, _b, q) => {
  const month = monthOf(q.get('month')), by = new Map()
  for (const r of monthRows(month)) { const s = by.get(r.uid) || { id: r.uid, name: r.name, days: 0, hours: 0, missing: 0 }; if (r.in_at) { s.days++; if (!r.out_at && r.date !== dubaiDay()) s.missing++ } s.hours = Math.round((s.hours + hours(r)) * 100) / 100; by.set(r.uid, s) }
  const months = db.prepare(`SELECT DISTINCT substr(date,1,7) m FROM days WHERE in_at IS NOT NULL ORDER BY m DESC`).all().map(r => r.m)
  json(res, 200, { month, months, rows: [...by.values()] })
})
route('GET', '/api/team/csv', 'manager', (_q, res, _u, _m, _b, q) => {
  const month = monthOf(q.get('month')), head = ['Name', 'Email', 'Date', 'Check in', 'Check out', 'Hours', 'Location', 'Tasks done', 'Summary']
  const t = iso => iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''
  const body = monthRows(month).map(r => [r.name, r.email, r.date, t(r.in_at), t(r.out_at), r.in_at && r.out_at ? hours(r) : '', r.loc, JSON.parse(r.tasks).filter(x => x.done).map(x => x.text).join('; '), r.note])
  // Leading = + - @ would be run as formulas by spreadsheets; prefix them.
  const safe = v => /^[=+\-@\t\r]/.test(String(v)) ? "'" + v : v
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="swk-attendance-${month}.csv"`, 'cache-control': 'no-store' })
  res.end([head, ...body].map(l => l.map(v => csvEscape(safe(v))).join(',')).join('\n'))
})
route('GET', '/api/users', 'manager', (_q, res) => json(res, 200, db.prepare('SELECT * FROM users ORDER BY active DESC, name').all().map(pub)))
route('POST', '/api/users', 'manager', (_q, res, _u, _m, b) => {
  const email = str(b.email, 200, 'Email').toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('Invalid email')
  const role = b.role === 'manager' ? 'manager' : 'staff'; pwOk(b.password)
  try { const r = db.prepare('INSERT INTO users(email,name,role,pw,must_change) VALUES(?,?,?,?,1)').run(email, str(b.name, 100, 'Name'), role, hashPw(b.password)); json(res, 201, pub(db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid))) }
  catch (e) { if (String(e.message).includes('UNIQUE')) bad('Email already exists', 409); throw e }
})
route('PATCH', '/api/users/(\\d+)', 'manager', (_q, res, me_, m, b) => {
  const id = Number(m[1]), t = db.prepare('SELECT * FROM users WHERE id=?').get(id); if (!t) bad('No such user', 404)
  if (id === me_.id && (b.active === false || (b.role && b.role !== 'manager'))) bad('You cannot deactivate or demote yourself', 409)
  if (b.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(str(b.name, 100, 'Name'), id)
  if (b.role !== undefined) db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role === 'manager' ? 'manager' : 'staff', id)
  if (b.active !== undefined) { db.prepare('UPDATE users SET active=? WHERE id=?').run(b.active ? 1 : 0, id); if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id) }
  if (b.password !== undefined) { pwOk(b.password); db.prepare('UPDATE users SET pw=?, must_change=1 WHERE id=?').run(hashPw(b.password), id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(id) }
  json(res, 200, pub(db.prepare('SELECT * FROM users WHERE id=?').get(id)))
})

// ---- static + dispatch
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const file = path.resolve(PUBLIC, rel)
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Not found' })
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': rel === 'sw.js' ? 'no-cache' : 'no-cache', ...SEC })
  fs.createReadStream(file).pipe(res)
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url)
    const mutate = req.method !== 'GET'
    if (mutate) { // CSRF: SameSite=Strict cookie plus a same-origin and JSON-only check
      const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) bad('Bad origin', 403)
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) bad('JSON required', 415)
    }
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname))
    if (!r) bad('Not found', 404)
    let u = null
    if (r.role) {
      const s = db.prepare('SELECT user_id, expires FROM sessions WHERE token=?').get(sha(cookie(req).sid || ''))
      if (!s || s.expires < Date.now()) bad('Sign in required', 401)
      u = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(s.user_id); if (!u) bad('Sign in required', 401)
      if (u.must_change && !['/api/me', '/api/password', '/api/logout'].includes(url.pathname)) bad('Change your password first', 403)
      if (r.role === 'manager' && u.role !== 'manager') bad('Managers only', 403)
    }
    await r.fn(req, res, u, url.pathname.match(r.re), mutate ? await readBody(req) : {}, url.searchParams)
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message })
    console.error(e); json(res, 500, { error: 'Server error' })
  }
})

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('server.js')) {
  server.listen(PORT, () => console.log(`SWK Daily on :${PORT}`))
  setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()), 36e5).unref()
}
