import { closingCosts, monthlyPayment, grossYield, commissionSplit, reraIncrease, dayKey, hhmm, hoursBetween, toCsv, weekKeys } from './calc.js'

const $ = (s, r = document) => r.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const aed = n => 'AED ' + Number(n).toLocaleString('en-AE', { maximumFractionDigits: 2 })
const app = $('#app'), nav = $('#nav')
let me = null, month = '', tmonth = ''

class AuthError extends Error {}
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : method === 'GET' ? {} : { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 && path !== '/api/login') { me = null; throw new AuthError() }
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`)
  return j
}
const get = p => api('GET', p)
const fail = e => { if (!(e instanceof AuthError)) alert(e.message); else boot() }
const guard = fn => async (...a) => { try { await fn(...a) } catch (e) { fail(e) } }
const gps = () => new Promise(r => navigator.geolocation
  ? navigator.geolocation.getCurrentPosition(p => r(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`), () => r(''), { timeout: 8000 })
  : r(''))
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

// ---------- auth screens
function loginScreen(msg = '', email = '') {
  nav.hidden = true
  app.innerHTML = `<h1>SWK Daily</h1><p class="dim">Sign in with your SWK account.</p>
  <form class="panel" id="f"><label>Email<input name="email" type="email" autocomplete="username" value="${esc(email)}" required></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <p class="bad" role="alert">${esc(msg)}</p><button class="punch gold">Sign in</button></form>`
  $('#f').onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target))
    try { me = await api('POST', '/api/login', d); boot() } catch (x) { loginScreen(x.message, d.email) }
  }
}
function passwordScreen(msg = '') {
  nav.hidden = true
  app.innerHTML = `<h1>Set a new password</h1><p class="dim">${me.must_change ? 'You must change your temporary password to continue.' : ''} Minimum 10 characters.</p>
  <form class="panel" id="f"><label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
  <label>New password<input name="next" type="password" autocomplete="new-password" minlength="10" required></label>
  <p class="bad" role="alert">${esc(msg)}</p><button class="punch gold">Save password</button></form>`
  $('#f').onsubmit = async e => {
    e.preventDefault()
    try { await api('POST', '/api/password', Object.fromEntries(new FormData(e.target))); me = await get('/api/me'); boot() } catch (x) { passwordScreen(x.message) }
  }
}

// ---------- staff screens
const ring = (done, total) => {
  const R = 40, C = 2 * Math.PI * R, f = total ? done / total : 0
  return `<svg class="ring" viewBox="0 0 100 100" role="img" aria-label="${done} of ${total} tasks done"><circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--line)" stroke-width="10"/>
  <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--gold)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * f} ${C}" transform="rotate(-90 50 50)"/>
  <text x="50" y="57" text-anchor="middle">${done}/${total}</text></svg>`
}

async function home() {
  const d = await get('/api/day'), done = d.tasks.filter(t => t.done).length
  const { rows } = await get('/api/days?month=' + dayKey().slice(0, 7))
  const present = new Set(rows.filter(r => r.in).map(r => r.date)); present.add(d.in ? d.date : '')
  const hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
  const state = !d.in ? 'Not checked in' : !d.out ? `In since ${hhmm(d.in)}` : `${hhmm(d.in)} to ${hhmm(d.out)}, ${hoursBetween(d.in, d.out)} h`
  app.innerHTML = `<p class="dim">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>${hi}, ${esc(me.name.split(' ')[0])}</h1>
  <section class="panel"><div class="hero">${ring(done, d.tasks.length)}<div><b>${state}</b><div class="dim">${d.loc ? 'GPS ' + esc(d.loc) : 'GPS optional'}</div></div></div>
    <button class="punch ${d.in && !d.out ? 'out' : ''}" id="punch" ${d.out ? 'disabled' : ''}>${d.in ? 'Check out' : 'Check in'}</button>
    ${d.out ? '<button class="ghost mt" id="undo">Undo check-out</button>' : ''}</section>
  <h2>This week</h2><section class="week">${weekKeys().map((k, i) => `<div>${'MTWTFSS'[i]}<i class="${present.has(k) ? 'on' : ''} ${k === dayKey() ? 'now' : ''}" title="${k}"></i></div>`).join('')}</section>
  <h2>Work summary</h2><textarea id="note" rows="4" maxlength="2000" placeholder="What did you complete today? Viewings, calls, deals…">${esc(d.note)}</textarea><p class="dim" id="saved"></p>`
  $('#punch').onclick = guard(async e => {
    if (!d.in) { e.target.disabled = true; await api('POST', '/api/punch', { action: 'in', loc: await gps() }) }
    else { if (!$('#note').value.trim() && !confirm('No work summary written. Check out anyway?')) return; await api('POST', '/api/punch', { action: 'out' }) }
    home()
  })
  const u = $('#undo'); if (u) u.onclick = guard(async () => { await api('POST', '/api/punch', { action: 'undo' }); home() })
  const saveNote = debounce(guard(async v => { await api('PUT', '/api/day', { tasks: d.tasks, note: v }); $('#saved').textContent = 'Saved' }), 500)
  $('#note').oninput = e => { $('#saved').textContent = ''; saveNote(e.target.value) }
}

async function tasks() {
  const d = await get('/api/day'), put = async () => { await api('PUT', '/api/day', { tasks: d.tasks, note: d.note }); tasks() }
  app.innerHTML = `<h1>Tasks</h1><p class="dim">${d.date}</p>
  <section class="panel">${d.tasks.map((t, i) => `<label class="chk ${t.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label>`).join('') || '<p class="dim">Nothing yet.</p>'}</section>
  <label>New task<input id="nt" maxlength="200" placeholder="Type and press Enter"></label>
  <label class="chk nb"><input type="checkbox" id="rep"><span>Repeat every day</span></label>
  ${me.repeat.length ? `<h2>Daily routine</h2><section class="panel">${me.repeat.map((t, i) => `<div class="kv"><span>${esc(t)}</span><button class="ghost" data-r="${i}" aria-label="Remove ${esc(t)}">Remove</button></div>`).join('')}</section>` : ''}`
  app.querySelectorAll('[data-i]').forEach(c => c.onchange = guard(async () => { d.tasks[c.dataset.i].done = c.checked; await put() }))
  app.querySelectorAll('[data-r]').forEach(b => b.onclick = guard(async () => { me.repeat.splice(b.dataset.r, 1); await api('PUT', '/api/repeat', { repeat: me.repeat }); tasks() }))
  $('#nt').onkeydown = guard(async e => {
    const text = e.target.value.trim(); if (e.key !== 'Enter' || !text) return
    d.tasks.push({ text, done: false })
    if ($('#rep').checked && !me.repeat.includes(text)) { me.repeat.push(text); await api('PUT', '/api/repeat', { repeat: me.repeat }) }
    await put()
  })
}

async function history() {
  const { rows, months, month: m } = await get('/api/days' + (month ? '?month=' + month : '')); month = m
  const hrs = rows.reduce((s, r) => s + (r.in && r.out ? hoursBetween(r.in, r.out) : 0), 0)
  app.innerHTML = `<h1>History</h1>
  <select id="mo" aria-label="Month">${[...new Set([m, ...months])].map(x => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select>
  <section class="panel"><div class="kv"><span>Days present</span><b>${rows.filter(r => r.in).length}</b></div><div class="kv"><span>Hours</span><b>${Math.round(hrs * 100) / 100}</b></div>
  <button class="punch gold" id="csv" ${rows.length ? '' : 'disabled'}>Export CSV</button></section>
  ${rows.slice().reverse().map(r => `<section class="panel"><div class="kv"><b>${r.date}</b><span>${r.in ? hhmm(r.in) : '—'} to ${r.out ? hhmm(r.out) : r.in ? 'missing' : '—'}</span></div>
    <div class="dim">${r.tasks.filter(t => t.done).length}/${r.tasks.length} tasks</div>${r.note ? `<p>${esc(r.note)}</p>` : ''}</section>`).join('')}`
  $('#mo').onchange = e => { month = e.target.value; history().catch(fail) }
  $('#csv').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCsv(rows.map(r => ({ ...r, summary: r.note })))], { type: 'text/csv' }))
    a.download = `swk-attendance-${m}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
}

// ---------- tools
const f = (id, label, v = '', extra = '') => `<label>${label}<input data-k="${id}" type="number" inputmode="decimal" value="${v}" ${extra}></label>`
const TOOLS = [
  ['Cost to close', f('p', 'Price (AED)') + f('l', 'Loan (AED, 0 if cash)', 0), v => {
    const c = closingCosts(v.p, { mortgage: v.l > 0, loan: v.l })
    return [['DLD 4%', c.dld], ['DLD admin', c.admin], ['Agency 2%', c.agency], ['VAT 5%', c.vat], ['Mortgage reg.', c.mReg], ['Total fees', c.total], ['Cash needed', c.cash]].map(([k, x]) => `<div class="kv"><span>${k}</span><b>${aed(x)}</b></div>`).join('') + '<p class="dim">Indicative. Agency fee assumed 2%.</p>' }],
  ['Mortgage', f('l', 'Loan (AED)') + f('r', 'Rate % p.a.', 4.5, 'step=0.01') + f('y', 'Years', 25), v => {
    const m = monthlyPayment(v.l, v.r, v.y); return `<div class="kv"><span>Monthly</span><b>${aed(m)}</b></div><div class="kv"><span>Total interest</span><b>${aed(m * v.y * 12 - v.l)}</b></div>` }],
  ['Rental yield', f('p', 'Price (AED)') + f('a', 'Annual rent (AED)'), v => `<div class="kv"><span>Gross yield</span><b>${grossYield(v.p, v.a)}%</b></div>`],
  ['Commission split', f('p', 'Sale price (AED)') + f('c', 'Commission %', 2, 'step=0.1') + f('s', 'Agent share %', 50), v => {
    const c = commissionSplit(v.p, v.c, v.s); return [['Gross', c.gross], ['VAT 5%', c.vat], ['Agent', c.agent], ['Company', c.company]].map(([k, x]) => `<div class="kv"><span>${k}</span><b>${aed(x)}</b></div>`).join('') }],
  ['RERA rent increase', f('r', 'Current rent (AED/yr)') + f('i', 'RERA index average (AED/yr)'), v => {
    const x = reraIncrease(v.r, v.i); return `<div class="kv"><span>Below index</span><b>${x.below}%</b></div><div class="kv"><span>Max increase</span><b>${x.pct}%</b></div><div class="kv"><span>Max new rent</span><b>${aed(x.maxRent)}</b></div><p class="dim">Decree 43/2013 bands, indicative. Confirm with the official RERA calculator and 90-day notice rule.</p>` }],
]
function tools() {
  app.innerHTML = `<h1>Tools</h1><section class="panel">${TOOLS.map(([n, form], i) => `<details data-t="${i}" ${i ? '' : 'open'}><summary>${n}</summary><div>${form}<div class="o"></div></div></details>`).join('')}</section>
  <h2>Staff manual</h2><section class="panel"><p><b>Attendance.</b> Check in on arrival, check out at end of shift, and write your work summary first. Early or late client appointments: say why in the summary.</p><br>
  <p><b>Records.</b> Times are recorded by the server. Your manager can see attendance, tasks and summaries.</p></section>`
  app.querySelectorAll('details').forEach(d => {
    const run = TOOLS[d.dataset.t][2], out = $('.o', d)
    d.oninput = () => { const v = {}; d.querySelectorAll('[data-k]').forEach(i => v[i.dataset.k] = parseFloat(i.value) || 0); out.innerHTML = run(v) }
    d.oninput()
  })
}

// ---------- manager
async function team() {
  const [today, rep, users] = await Promise.all([get('/api/team/today'), get('/api/team/report' + (tmonth ? '?month=' + tmonth : '')), get('/api/users')]); tmonth = rep.month
  const st = r => !r.in ? '<span class="bad">Absent</span>' : r.out ? `<span class="dim">${hhmm(r.in)}–${hhmm(r.out)}</span>` : `<span class="ok">In ${hhmm(r.in)}</span>`
  const inCount = today.rows.filter(r => r.in).length
  app.innerHTML = `<h1>Team</h1><p class="dim">${today.date} · ${inCount}/${today.rows.length} checked in</p>
  <h2>Today</h2><section class="panel">${today.rows.map(r => `<details><summary class="kv"><span>${esc(r.name)}</span>${st(r)}</summary>
    <div class="dim">Tasks ${r.done}/${r.total}${r.loc ? ' · GPS ' + esc(r.loc) : ''}</div>${r.note ? `<p>${esc(r.note)}</p>` : '<p class="dim">No summary yet.</p>'}</details>`).join('') || '<p class="dim">No staff.</p>'}</section>
  <h2>Monthly report</h2><select id="tm" aria-label="Month">${[...new Set([rep.month, ...rep.months])].map(x => `<option ${x === rep.month ? 'selected' : ''}>${x}</option>`).join('')}</select>
  <section class="panel"><table><thead><tr><th>Name</th><th>Days</th><th>Hours</th><th>No out</th></tr></thead><tbody>${rep.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.days}</td><td>${r.hours}</td><td class="${r.missing ? 'bad' : ''}">${r.missing}</td></tr>`).join('') || '<tr><td colspan="4" class="dim">No records.</td></tr>'}</tbody></table>
  <a class="punch gold btn" href="/api/team/csv?month=${rep.month}" download>Export team CSV</a></section>
  <h2>Staff</h2><section class="panel">${users.map(u => `<div class="kv"><span>${esc(u.name)} <span class="dim">${esc(u.role)} · ${esc(u.email)}${u.active ? '' : ' · inactive'}</span></span>
    ${u.id === me.id ? '' : `<button class="ghost" data-act="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'Deactivate' : 'Activate'}</button>`}</div>`).join('')}</section>
  <h2>Add staff</h2><form class="panel" id="add"><label>Name<input name="name" required maxlength="100"></label><label>Email<input name="email" type="email" required></label>
  <label>Role<select name="role"><option value="staff">Staff</option><option value="manager">Manager</option></select></label>
  <label>Temporary password (min 10)<input name="password" type="text" minlength="10" required autocomplete="off"></label><button class="punch gold">Create</button></form>
  <h2>Reset password</h2><form class="panel" id="reset"><label>User<select name="id">${users.filter(u => u.id !== me.id).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
  <label>Temporary password (min 10)<input name="password" type="text" minlength="10" required autocomplete="off"></label><button class="punch gold">Reset</button></form>`
  $('#tm').onchange = e => { tmonth = e.target.value; team().catch(fail) }
  app.querySelectorAll('[data-act]').forEach(b => b.onclick = guard(async () => { await api('PATCH', '/api/users/' + b.dataset.act, { active: b.dataset.on === '1' }); team() }))
  $('#add').onsubmit = guard(async e => { e.preventDefault(); await api('POST', '/api/users', Object.fromEntries(new FormData(e.target))); team() })
  $('#reset').onsubmit = guard(async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); await api('PATCH', '/api/users/' + d.id, { password: d.password }); alert('Password reset. The user must change it at next sign-in.'); team() })
}

// ---------- shell
const SCREENS = { home, tasks, history, tools, team }, LABEL = { home: 'Home', tasks: 'Tasks', history: 'History', tools: 'Tools', team: 'Team' }
function go(t) {
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t))
  Promise.resolve(SCREENS[t]()).catch(fail); scrollTo(0, 0)
}
nav.onclick = e => { if (e.target.dataset.t) go(e.target.dataset.t); else if (e.target.id === 'out') api('POST', '/api/logout', {}).finally(() => { me = null; boot() }) }
async function boot() {
  if (!me) { try { me = await get('/api/me') } catch { return loginScreen() } }
  if (me.must_change) return passwordScreen()
  const tabs = me.role === 'manager' ? ['team', 'home', 'tasks', 'history', 'tools'] : ['home', 'tasks', 'history', 'tools']
  nav.hidden = false
  nav.innerHTML = tabs.map(k => `<button data-t="${k}">${LABEL[k]}</button>`).join('') + '<button id="out">Sign out</button>'
  go(tabs[0])
}
boot()
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
