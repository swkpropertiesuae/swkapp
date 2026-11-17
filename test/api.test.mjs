import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import pg from 'pg'

// Needs a Postgres: TEST_DATABASE_URL=postgres://... npm test. Uses a throwaway schema.
const URL_ = process.env.TEST_DATABASE_URL, SCHEMA = 'swk_test_' + Math.random().toString(36).slice(2, 8)
const PORT = 18000 + Math.floor(Math.random() * 1000), B = `http://127.0.0.1:${PORT}`
let proc

before(async () => {
  if (!URL_) return
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    env: { ...process.env, PORT, DATABASE_URL: URL_, DB_SCHEMA: SCHEMA, SWK_ADMIN_EMAIL: 'boss@x.test', SWK_ADMIN_PASSWORD: 'boss-password-1' }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/'); return } catch { await new Promise(r => setTimeout(r, 100)) } }
  throw new Error('server did not start')
})
after(async () => { proc?.kill(); if (!URL_) return; const c = new pg.Client({ connectionString: URL_ }); await c.connect(); await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); await c.end() })

// tiny client that keeps its own cookie
const client = () => {
  let sid = ''
  return async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(sid && { cookie: sid }) }, body: body && JSON.stringify(body) })
    const c = r.headers.get('set-cookie'); if (c) sid = c.split(';')[0]
    const text = await r.text(); let j; try { j = JSON.parse(text) } catch { j = text }
    return { status: r.status, body: j, headers: r.headers }
  }
}

const T = URL_ ? test : (n, f) => test(n, { skip: 'set TEST_DATABASE_URL' }, f)
T('flow: login, staff punch, manager sees it', async () => {
  const boss = client(), anon = client()
  assert.equal((await anon('GET', '/api/me')).status, 401)
  assert.equal((await anon('POST', '/api/login', { email: 'boss@x.test', password: 'nope' })).status, 401)
  const l = await boss('POST', '/api/login', { email: 'BOSS@x.test', password: 'boss-password-1' })
  assert.equal(l.status, 200); assert.equal(l.body.role, 'manager')
  assert.match(l.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)

  assert.equal((await boss('POST', '/api/users', { name: 'Sam', email: 'sam@x.test', password: 'short' })).status, 400)
  const mk = await boss('POST', '/api/users', { name: 'Sam', email: 'sam@x.test', password: 'temp-password-1' })
  assert.equal(mk.status, 201)
  assert.equal((await boss('POST', '/api/users', { name: 'Sam2', email: 'sam@x.test', password: 'temp-password-1' })).status, 409)

  const sam = client()
  assert.equal((await sam('POST', '/api/login', { email: 'sam@x.test', password: 'temp-password-1' })).body.must_change, true)
  assert.equal((await sam('GET', '/api/day')).status, 403) // must change password first
  assert.equal((await sam('POST', '/api/password', { current: 'temp-password-1', next: 'sam-password-22' })).status, 200)

  assert.equal((await sam('POST', '/api/punch', { action: 'out' })).status, 409)
  assert.equal((await sam('PUT', '/api/repeat', { repeat: ['Check leads'] })).status, 200)
  assert.equal((await sam('POST', '/api/punch', { action: 'in', loc: '25.20000,55.27000' })).status, 200)
  assert.equal((await sam('POST', '/api/punch', { action: 'in' })).status, 409)
  assert.equal((await sam('PUT', '/api/day', { note: 'Two viewings', tasks: [{ text: 'Call', done: true }] })).status, 200)
  assert.equal((await sam('PUT', '/api/day', { note: 'x'.repeat(2001), tasks: [] })).status, 400)
  const out = await sam('POST', '/api/punch', { action: 'out' })
  assert.ok(out.body.in && out.body.out)

  assert.equal((await sam('GET', '/api/team/today')).status, 403)
  assert.equal((await sam('GET', '/api/users')).status, 403)
  const t = await boss('GET', '/api/team/today')
  const row = t.body.rows.find(r => r.email === 'sam@x.test')
  assert.ok(row.in && row.out); assert.equal(row.done, 1)

  const rep = await boss('GET', '/api/team/report')
  assert.equal(rep.body.rows.find(r => r.name === 'Sam').days, 1)
  const csv = await boss('GET', '/api/team/csv')
  assert.match(csv.body, /Sam,sam@x.test/); assert.match(csv.body, /Two viewings/)

  // deactivate kills the session; boss cannot lock self out
  assert.equal((await boss('PATCH', `/api/users/${mk.body.id}`, { active: false })).status, 200)
  assert.equal((await sam('GET', '/api/me')).status, 401)
  assert.equal((await boss('PATCH', `/api/users/${l.body.id}`, { active: false })).status, 409)
})

T('csrf: non-JSON and foreign origin rejected; path traversal blocked; lockout', async () => {
  const c = client()
  assert.equal((await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
  assert.equal((await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.test' }, body: '{}' })).status, 403)
  assert.equal((await fetch(B + '/..%2Fserver.js')).status, 404)
  assert.equal((await fetch(B + '/server.js')).status, 404)
  for (let i = 0; i < 5; i++) await c('POST', '/api/login', { email: 'victim@x.test', password: 'wrong-password' })
  assert.equal((await c('POST', '/api/login', { email: 'victim@x.test', password: 'wrong-password' })).status, 429)
})
