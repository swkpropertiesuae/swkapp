import { closingCosts, monthlyPayment, grossYield, commissionSplit, reraIncrease, dayKey, hhmm, hoursBetween, toCsv, weekKeys} from './calc.js'

const KEY = 'swk-daily-v2'
const fresh = () => ({ days: {}, repeat: [] })
let db
try { db = JSON.parse(localStorage.getItem(KEY)) || fresh() } catch { db = fresh() }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { alert('Could not save: storage blocked or full.') } }
const $ = (s, r = document) => r.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const aed = n => 'AED ' + Number(n).toLocaleString('en-AE', { maximumFractionDigits: 2 })
const day = () => (db.days[dayKey()] ||= { date: dayKey(), tasks: db.repeat.map(text => ({ text, done: false })), note: '' })

const app = $('#app')
let tab = 'home', month = ''

const gps = () => new Promise(r => navigator.geolocation
  ? navigator.geolocation.getCurrentPosition(p => r(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`), () => r(''), { timeout: 8000 })
  : r(''))

function ring(done, total) {
  const R = 40, C = 2 * Math.PI * R, f = total ? done / total : 0
  return `<svg class="ring" viewBox="0 0 100 100" role="img" aria-label="${done} of ${total} tasks done"><circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--line)" stroke-width="10"/>
  <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--gold)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * f} ${C}" transform="rotate(-90 50 50)"/>
  <text x="50" y="57" text-anchor="middle">${done}/${total}</text></svg>`
}

function home() {
  const d = day(), done = d.tasks.filter(t => t.done).length
  const hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
  const state = !d.in ? 'Not checked in' : !d.out ? `In since ${hhmm(d.in)}` : `${hhmm(d.in)} to ${hhmm(d.out)}, ${hoursBetween(d.in, d.out)} h`
  const wk = weekKeys(), names = 'MTWTFSS'
  app.innerHTML = `<p class="dim">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>${hi}</h1>
  <section class="panel"><div class="hero">${ring(done, d.tasks.length)}<div><b>${state}</b><div class="dim">${d.loc ? 'GPS ' + esc(d.loc) : 'GPS optional'}</div></div></div>
    <button class="punch ${d.in && !d.out ? 'out' : ''}" id="punch" ${d.out ? 'disabled' : ''}>${d.in ? 'Check out' : 'Check in'}</button>
    ${d.out ? '<button class="ghost" id="undo" style="margin-top:10px">Undo check-out</button>' : ''}</section>
  <h2>This week</h2><section class="week">${wk.map((k, i) => `<div>${names[i]}<i class="${db.days[k]?.in ? 'on' : ''} ${k === dayKey() ? 'now' : ''}" title="${k}"></i></div>`).join('')}</section>
  <h2>Work summary</h2><textarea id="note" rows="4" placeholder="What did you complete today? Viewings, calls, deals…">${esc(d.note)}</textarea>`
  $('#punch').onclick = async e => {
    if (!d.in) { e.target.disabled = true; d.loc = await gps(); d.in = new Date().toISOString() }
    else { if (!d.note.trim() && !confirm('No work summary written. Check out anyway?')) return; d.out = new Date().toISOString() }
    save(); home()
  }
  const u = $('#undo'); if (u) u.onclick = () => { delete d.out; save(); home() }
  $('#note').oninput = e => { d.note = e.target.value; save() }
}

function tasks() {
  const d = day()
  app.innerHTML = `<h1>Tasks</h1><p class="dim">${d.date}</p>
  <section class="panel">${d.tasks.map((t, i) => `<label class="chk ${t.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label>`).join('') || '<p class="dim">Nothing yet.</p>'}</section>
  <label>New task<input id="nt" placeholder="Type and press Enter"></label>
  <label class="chk" style="border:0"><input type="checkbox" id="rep"><span>Repeat every day</span></label>
  ${db.repeat.length ? `<h2>Daily routine</h2><section class="panel">${db.repeat.map((t, i) => `<div class="kv"><span>${esc(t)}</span><button class="ghost" data-r="${i}" aria-label="Remove ${esc(t)}">Remove</button></div>`).join('')}</section>` : ''}`
  app.querySelectorAll('[data-i]').forEach(c => c.onchange = () => { d.tasks[c.dataset.i].done = c.checked; save(); tasks() })
  app.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { db.repeat.splice(b.dataset.r, 1); save(); tasks() })
  $('#nt').onkeydown = e => {
    const text = e.target.value.trim(); if (e.key !== 'Enter' || !text) return
    d.tasks.push({ text, done: false }); if ($('#rep').checked && !db.repeat.includes(text)) db.repeat.push(text)
    save(); tasks()
  }
}

function history() {
  const months = [...new Set(Object.keys(db.days).map(k => k.slice(0, 7)))].sort().reverse()
  month ||= months[0] || dayKey().slice(0, 7)
  const rows = Object.values(db.days).filter(r => r.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))
  const hrs = rows.reduce((s, r) => s + (r.in && r.out ? hoursBetween(r.in, r.out) : 0), 0)
  app.innerHTML = `<h1>History</h1>
  <select id="mo" aria-label="Month">${(months.length ? months : [month]).map(m => `<option ${m === month ? 'selected' : ''}>${m}</option>`).join('')}</select>
  <section class="panel"><div class="kv"><span>Days present</span><b>${rows.filter(r => r.in).length}</b></div><div class="kv"><span>Hours</span><b>${Math.round(hrs * 100) / 100}</b></div>
  <button class="punch" id="csv" style="background:var(--gold);color:#14110f" ${rows.length ? '' : 'disabled'}>Export CSV</button></section>
  ${rows.slice().reverse().map(r => `<section class="panel"><div class="kv"><b>${r.date}</b><span>${r.in ? hhmm(r.in) : '—'} to ${r.out ? hhmm(r.out) : r.in ? 'missing' : '—'}</span></div>
    <div class="dim">${r.tasks.filter(t => t.done).length}/${r.tasks.length} tasks</div>${r.note ? `<p>${esc(r.note)}</p>` : ''}</section>`).join('')}`
  $('#mo').onchange = e => { month = e.target.value; history() }
  $('#csv').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCsv(rows.map(r => ({ ...r, summary: r.note })))], { type: 'text/csv' }))
    a.download = `swk-attendance-${month}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
}

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
  <p><b>Records.</b> Data stays on this device. Export the monthly CSV and send it to your manager at month end.</p></section>`
  app.querySelectorAll('details').forEach(d => {
    const run = TOOLS[d.dataset.t][2], out = $('.o', d)
    d.oninput = () => { const v = {}; d.querySelectorAll('[data-k]').forEach(i => v[i.dataset.k] = parseFloat(i.value) || 0); out.innerHTML = run(v) }
    d.oninput()
  })
}

const SCREENS = { home, tasks, history, tools }, LABEL = { home: 'Home', tasks: 'Tasks', history: 'History', tools: 'Tools' }
const nav = $('#nav')
nav.innerHTML = Object.keys(SCREENS).map(k => `<button data-t="${k}">${LABEL[k]}</button>`).join('')
function go(t) { tab = t; nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); SCREENS[t](); scrollTo(0, 0) }
nav.onclick = e => e.target.dataset.t && go(e.target.dataset.t)
go('home')
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
