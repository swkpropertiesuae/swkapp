import crypto from 'node:crypto'
import pg from 'pg'
import { hoursBetween, csvEscape } from '../public/calc.js'

const env = process.env
const SECURE = env.SECURE_COOKIES === '1' || env.VERCEL === '1'
const TZ = 'Asia/Dubai'
const SESSION_MS = 14 * 864e5
const PW_MIN = 10
const SCHEMA = env.DB_SCHEMA // tests only: isolate in their own schema

const pool = new pg.Pool({ connectionString: env.DATABASE_URL || env.POSTGRES_URL, max: 3 })
if (SCHEMA) pool.on('connect', c => c.query(`SET search_path TO ${SCHEMA}`))
const q = async (s, p = []) => (await pool.query(s, p)).rows
const one = async (s, p) => (await q(s, p))[0]

// ---- passwords: scrypt, stored as salt:hash (hex)
const hashPw = pw => { const s = crypto.randomBytes(16); return `${s.toString('hex')}:${crypto.scryptSync(pw, s, 64).toString('hex')}` }
const checkPw = (pw, stored) => {
  const [s, h] = stored.split(':'); const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
const DUMMY = hashPw('x') // equalises timing for unknown emails
const sha = t => crypto.createHash('sha256').update(t).digest('hex')
const dubaiDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

// ---- schema + first manager, once per process
let ready
export const init = () => ready ||= (async () => {
  if (SCHEMA) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
  await q(`
CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN('manager','staff')),
  pw TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, must_change BOOLEAN NOT NULL DEFAULT FALSE, repeat JSONB NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS days(user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, in_at TIMESTAMPTZ, out_at TIMESTAMPTZ,
  loc TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', tasks JSONB NOT NULL DEFAULT '[]', PRIMARY KEY(user_id,date));
CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, n INT NOT NULL DEFAULT 0, until BIGINT NOT NULL DEFAULT 0);`)
  if (!(await one('SELECT 1 FROM users'))) {
    const { SWK_ADMIN_EMAIL: e, SWK_ADMIN_PASSWORD: p } = env
    if (!e || !p || p.length < PW_MIN) throw new Error(`No users yet. Set SWK_ADMIN_EMAIL and SWK_ADMIN_PASSWORD (min ${PW_MIN} chars) to create the first manager.`)
    await q('INSERT INTO users(email,name,role,pw) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [e.trim().toLowerCase(), env.SWK_ADMIN_NAME || 'Manager', 'manager', hashPw(p)])
    console.log('Created first manager', e)
  }
})().catch(e => { ready = null; throw e })

// ---- helpers
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status } }
const bad = (m, s = 400) => { throw new HttpError(s, m) }
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)) }
const readBody = req => new Promise((ok, no) => {
  let n = 0; const c = []
  req.on('data', b => { n += b.length; if (n > 1e5) { no(new HttpError(413, 'Too large')); req.destroy() } else c.push(b) })
  req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c)) : {}) } catch { no(new HttpError(400, 'Bad JSON')) } })
})
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)] }))
const str = (v, max, name) => { if (typeof v !== 'string' || !v.trim() || v.length > max) bad(`${name} required (max ${max} chars)`); return v.trim() }
const monthOf = m => { m ||= dubaiDay().slice(0, 7); if (!/^\d{4}-\d{2}$/.test(m)) bad('Bad month'); return m }
const iso = d => d ? d.toISOString() : null

// Login throttle in the database so it holds across serverless instances.
async function throttle(key) { const r = await one('SELECT until FROM attempts WHERE key=$1', [key]); if (r && Number(r.until) > Date.now()) bad('Too many attempts. Try again in 15 minutes.', 429) }
const fail = key => q(`INSERT INTO attempts(key,n) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET
  n = CASE WHEN attempts.n+1>=5 THEN 0 ELSE attempts.n+1 END,
  until = CASE WHEN attempts.n+1>=5 THEN $2 ELSE attempts.until END`, [key, Date.now() + 15 * 6e4])

const pub = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, must_change: u.must_change })
const me = u => ({ ...pub(u), repeat: u.repeat })
const dayRow = r => r && ({ date: r.date, in: iso(r.in_at), out: iso(r.out_at), loc: r.loc, note: r.note, tasks: r.tasks })

async function todayRow(u) {
  const date = dubaiDay()
  await q('INSERT INTO days(user_id,date,tasks) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [u.id, date, JSON.stringify(u.repeat.map(text => ({ text, done: false })))])
  return one('SELECT * FROM days WHERE user_id=$1 AND date=$2', [u.id, date])
}
function cleanTasks(t) {
  if (!Array.isArray(t) || t.length > 50) bad('Tasks must be a list of at most 50')
  return t.map(x => ({ text: str(x?.text, 200, 'Task text'), done: x.done === true }))
}
const monthRows = m => q(`SELECT u.id uid, u.name, u.email, d.* FROM days d JOIN users u ON u.id=d.user_id WHERE d.date LIKE $1 ORDER BY u.name, d.date`, [m + '-%'])
const hours = r => (r.in_at && r.out_at ? hoursBetween(r.in_at, r.out_at) : 0)
const getDay = (uid, date) => one('SELECT * FROM days WHERE user_id=$1 AND date=$2', [uid, date])

// ---- routes
const routes = []
const route = (method, pattern, role, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), role, fn })
const pwOk = p => (typeof p === 'string' && p.length >= PW_MIN && p.length <= 200) || bad(`Password must be ${PW_MIN}-200 characters`)
const clearCookie = `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}`

route('POST', '/api/login', null, async (req, res, _u, _m, body) => {
  const email = String(body.email || '').trim().toLowerCase(), key = `${req.socket?.remoteAddress || req.headers['x-forwarded-for'] || ''}|${email}`
  await throttle(key)
  const u = await one('SELECT * FROM users WHERE email=$1', [email])
  const ok = checkPw(String(body.password || ''), u ? u.pw : DUMMY) && u && u.active
  if (!ok) { await fail(key); bad('Wrong email or password', 401) }
  await q('DELETE FROM attempts WHERE key=$1', [key]); await q('DELETE FROM sessions WHERE expires<$1', [Date.now()])
  const token = crypto.randomBytes(32).toString('hex')
  await q('INSERT INTO sessions(token,user_id,expires) VALUES($1,$2,$3)', [sha(token), u.id, Date.now() + SESSION_MS])
  json(res, 200, me(u), { 'set-cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${SECURE ? '; Secure' : ''}` })
})
route('POST', '/api/logout', 'any', async (req, res) => {
  await q('DELETE FROM sessions WHERE token=$1', [sha(cookie(req).sid || '')]); json(res, 200, { ok: true }, { 'set-cookie': clearCookie })
})
route('GET', '/api/me', 'any', (_q, res, u) => json(res, 200, me(u)))
route('POST', '/api/password', 'any', async (req, res, u, _m, b) => {
  if (!checkPw(String(b.current || ''), u.pw)) bad('Current password is wrong', 403)
  pwOk(b.next); if (b.next === b.current) bad('Choose a different password')
  await q('UPDATE users SET pw=$1, must_change=FALSE WHERE id=$2', [hashPw(b.next), u.id])
  await q('DELETE FROM sessions WHERE user_id=$1 AND token<>$2', [u.id, sha(cookie(req).sid)]) // sign out other devices
  json(res, 200, { ok: true })
})
route('PUT', '/api/repeat', 'any', async (_q, res, u, _m, b) => {
  const r = cleanTasks((b.repeat || []).map(text => ({ text }))).map(t => t.text)
  await q('UPDATE users SET repeat=$1 WHERE id=$2', [JSON.stringify(r), u.id]); json(res, 200, { repeat: r })
})
route('GET', '/api/day', 'any', async (_q, res, u) => json(res, 200, dayRow(await todayRow(u))))
route('PUT', '/api/day', 'any', async (_q, res, u, _m, b) => {
  const d = await todayRow(u), note = typeof b.note === 'string' && b.note.length <= 2000 ? b.note : bad('Note too long (max 2000)')
  await q('UPDATE days SET tasks=$1, note=$2 WHERE user_id=$3 AND date=$4', [JSON.stringify(cleanTasks(b.tasks)), note, u.id, d.date])
  json(res, 200, dayRow(await getDay(u.id, d.date)))
})
route('POST', '/api/punch', 'any', async (_q, res, u, _m, b) => {
  const d = await todayRow(u), now = new Date() // server clock is the source of truth
  if (b.action === 'in') { if (d.in_at) bad('Already checked in', 409); await q('UPDATE days SET in_at=$1, loc=$2 WHERE user_id=$3 AND date=$4', [now, /^-?\d+\.\d+,-?\d+\.\d+$/.test(b.loc || '') ? b.loc : '', u.id, d.date]) }
  else if (b.action === 'out') { if (!d.in_at) bad('Check in first', 409); if (d.out_at) bad('Already checked out', 409); await q('UPDATE days SET out_at=$1 WHERE user_id=$2 AND date=$3', [now, u.id, d.date]) }
  else if (b.action === 'undo') await q('UPDATE days SET out_at=NULL WHERE user_id=$1 AND date=$2', [u.id, d.date])
  else bad('Unknown action')
  json(res, 200, dayRow(await getDay(u.id, d.date)))
})
route('GET', '/api/days', 'any', async (_q, res, u, _m, _b, p) => {
  const month = monthOf(p.get('month'))
  const months = (await q(`SELECT DISTINCT substr(date,1,7) m FROM days WHERE user_id=$1 AND in_at IS NOT NULL ORDER BY m DESC`, [u.id])).map(r => r.m)
  json(res, 200, { month, months, rows: (await q('SELECT * FROM days WHERE user_id=$1 AND date LIKE $2 ORDER BY date', [u.id, month + '-%'])).map(dayRow) })
})

route('GET', '/api/team/today', 'manager', async (_q, res) => {
  const date = dubaiDay()
  const rows = await q(`SELECT u.id,u.name,u.email,u.role,d.in_at,d.out_at,d.loc,d.note,d.tasks FROM users u LEFT JOIN days d ON d.user_id=u.id AND d.date=$1 WHERE u.active ORDER BY u.name`, [date])
  json(res, 200, { date, rows: rows.map(r => { const t = r.tasks || []; return { id: r.id, name: r.name, email: r.email, role: r.role, in: iso(r.in_at), out: iso(r.out_at), loc: r.loc, note: r.note, done: t.filter(x => x.done).length, total: t.length } }) })
})
route('GET', '/api/team/report', 'manager', async (_q, res, _u, _m, _b, p) => {
  const month = monthOf(p.get('month')), by = new Map()
  for (const r of await monthRows(month)) { const s = by.get(r.uid) || { id: r.uid, name: r.name, days: 0, hours: 0, missing: 0 }; if (r.in_at) { s.days++; if (!r.out_at && r.date !== dubaiDay()) s.missing++ } s.hours = Math.round((s.hours + hours(r)) * 100) / 100; by.set(r.uid, s) }
  const months = (await q(`SELECT DISTINCT substr(date,1,7) m FROM days WHERE in_at IS NOT NULL ORDER BY m DESC`)).map(r => r.m)
  json(res, 200, { month, months, rows: [...by.values()] })
})
route('GET', '/api/team/csv', 'manager', async (_q, res, _u, _m, _b, p) => {
  const month = monthOf(p.get('month')), head = ['Name', 'Email', 'Date', 'Check in', 'Check out', 'Hours', 'Location', 'Tasks done', 'Summary']
  const t = d => d ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d) : ''
  const body = (await monthRows(month)).map(r => [r.name, r.email, r.date, t(r.in_at), t(r.out_at), r.in_at && r.out_at ? hours(r) : '', r.loc, r.tasks.filter(x => x.done).map(x => x.text).join('; '), r.note])
  // Leading = + - @ would be run as formulas by spreadsheets; prefix them.
  const safe = v => /^[=+\-@\t\r]/.test(String(v)) ? "'" + v : v
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="swk-attendance-${month}.csv"`, 'cache-control': 'no-store' })
  res.end([head, ...body].map(l => l.map(v => csvEscape(safe(v))).join(',')).join('\n'))
})
route('GET', '/api/users', 'manager', async (_q, res) => json(res, 200, (await q('SELECT * FROM users ORDER BY active DESC, name')).map(pub)))
route('POST', '/api/users', 'manager', async (_q, res, _u, _m, b) => {
  const email = str(b.email, 200, 'Email').toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('Invalid email')
  const role = b.role === 'manager' ? 'manager' : 'staff'; pwOk(b.password)
  try { json(res, 201, pub(await one('INSERT INTO users(email,name,role,pw,must_change) VALUES($1,$2,$3,$4,TRUE) RETURNING *', [email, str(b.name, 100, 'Name'), role, hashPw(b.password)]))) }
  catch (e) { if (e.code === '23505') bad('Email already exists', 409); throw e }
})
route('PATCH', '/api/users/(\\d+)', 'manager', async (_q, res, self, m, b) => {
  const id = Number(m[1]); if (!(await one('SELECT 1 FROM users WHERE id=$1', [id]))) bad('No such user', 404)
  if (id === self.id && (b.active === false || (b.role && b.role !== 'manager'))) bad('You cannot deactivate or demote yourself', 409)
  if (b.name !== undefined) await q('UPDATE users SET name=$1 WHERE id=$2', [str(b.name, 100, 'Name'), id])
  if (b.role !== undefined) await q('UPDATE users SET role=$1 WHERE id=$2', [b.role === 'manager' ? 'manager' : 'staff', id])
  if (b.active !== undefined) { await q('UPDATE users SET active=$1 WHERE id=$2', [!!b.active, id]); if (!b.active) await q('DELETE FROM sessions WHERE user_id=$1', [id]) }
  if (b.password !== undefined) { pwOk(b.password); await q('UPDATE users SET pw=$1, must_change=TRUE WHERE id=$2', [hashPw(b.password), id]); await q('DELETE FROM sessions WHERE user_id=$1', [id]) }
  json(res, 200, pub(await one('SELECT * FROM users WHERE id=$1', [id])))
})

// ---- dispatch (API only; static files are served by Vercel or server.js)
export async function handler(req, res) {
  const url = new URL(req.url, 'http://x')
  try {
    await init()
    if (req.method !== 'GET') { // CSRF: SameSite=Strict cookie plus a same-origin and JSON-only check
      const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) bad('Bad origin', 403)
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) bad('JSON required', 415)
    }
    const r = routes.find(x => x.method === req.method && x.re.test(url.pathname))
    if (!r) bad('Not found', 404)
    let u = null
    if (r.role) {
      const s = await one('SELECT user_id, expires FROM sessions WHERE token=$1', [sha(cookie(req).sid || '')])
      if (!s || Number(s.expires) < Date.now()) bad('Sign in required', 401)
      u = await one('SELECT * FROM users WHERE id=$1 AND active', [s.user_id]); if (!u) bad('Sign in required', 401)
      if (u.must_change && !['/api/me', '/api/password', '/api/logout'].includes(url.pathname)) bad('Change your password first', 403)
      if (r.role === 'manager' && u.role !== 'manager') bad('Managers only', 403)
    }
    await r.fn(req, res, u, url.pathname.match(r.re), req.method !== 'GET' ? await readBody(req) : {}, url.searchParams)
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message })
    console.error(e); json(res, 500, { error: 'Server error' })
  }
}
export const close = () => pool.end()
