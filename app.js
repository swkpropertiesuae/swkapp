import { closingCosts, monthlyPayment, grossYield, commissionSplit, reraIncrease, dayKey, hhmm, hoursBetween, toCsv, pad } from './calc.js'

const KEY = 'swk-daily-v1'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { days: {}, tpl: [] } } catch { return { days: {}, tpl: [] } } }
let db = load()
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { alert('Storage full or blocked: data not saved.') } }
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const aed = n => 'AED ' + Number(n).toLocaleString('en-AE', { maximumFractionDigits: 2 })
const today = () => (db.days[dayKey()] ||= { date: dayKey(), tasks: db.tpl.map(text => ({ text, done: false })), summary: '' })

let tab = 'today'
const view = $('#view')

function gps() {
  return new Promise(res => {
    if (!navigator.geolocation) return res('')
    navigator.geolocation.getCurrentPosition(p => res(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`), () => res(''), { timeout: 8000 })
  })
}

function renderToday() {
  const d = today()
  const status = !d.in ? 'Not checked in' : !d.out ? `Checked in ${hhmm(d.in)}` : `Done: ${hhmm(d.in)}–${hhmm(d.out)} (${hoursBetween(d.in, d.out)} h)`
  view.innerHTML = `
  <div class="card"><h2>Attendance</h2><div class="big">${status}</div>
    <div class="mut">${d.loc ? 'GPS ' + esc(d.loc) : 'GPS optional'} · ${d.date}</div><br>
    <button class="btn ${d.in && !d.out ? 'out' : ''}" id="punch" ${d.out ? 'disabled' : ''}>${d.in ? 'Check out' : 'Check in'}</button>
    ${d.out ? '<button class="btn out" id="reopen" style="margin-top:8px">Undo check-out</button>' : ''}</div>
  <div class="card"><h2>Today's tasks</h2><div id="tasks">${d.tasks.map((t, i) =>
    `<label class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label>`).join('') || '<div class="mut">No tasks yet.</div>'}</div>
    <input id="newtask" placeholder="Add task, press Enter">
    <label class="mut"><input type="checkbox" id="tpl" style="width:auto"> Repeat daily</label></div>
  <div class="card"><h2>Daily work summary</h2>
    <textarea id="sum" rows="4" placeholder="What did you complete today? Viewings, calls, deals…">${esc(d.summary)}</textarea>
    <div class="mut">Submit before checking out.</div></div>
  ${db.tpl.length ? `<div class="mut">Daily template: ${db.tpl.map(esc).join(' · ')} <a href="#" id="cleartpl">clear</a></div>` : ''}`

  $('#punch').onclick = async e => {
    if (!d.in) { e.target.disabled = true; d.loc = await gps(); d.in = new Date().toISOString() }
    else {
      if (!d.summary.trim() && !confirm('No daily summary written. Check out anyway?')) return
      d.out = new Date().toISOString()
    }
    save(); renderToday()
  }
  const re = $('#reopen'); if (re) re.onclick = () => { delete d.out; save(); renderToday() }
  view.querySelectorAll('#tasks input').forEach(c => c.onchange = () => { d.tasks[c.dataset.i].done = c.checked; save(); renderToday() })
  $('#newtask').onkeydown = e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return
    const text = e.target.value.trim(); d.tasks.push({ text, done: false })
    if ($('#tpl').checked && !db.tpl.includes(text)) db.tpl.push(text)
    save(); renderToday()
  }
  $('#sum').oninput = e => { d.summary = e.target.value; save() }
  const ct = $('#cleartpl'); if (ct) ct.onclick = e => { e.preventDefault(); db.tpl = []; save(); renderToday() }
}

function renderLog() {
  const now = new Date(), months = [...new Set(Object.keys(db.days).map(k => k.slice(0, 7)))].sort().reverse()
  const cur = view.dataset.m || months[0] || dayKey().slice(0, 7)
  const rows = Object.values(db.days).filter(r => r.date.startsWith(cur)).sort((a, b) => b.date.localeCompare(a.date))
  const present = rows.filter(r => r.in).length
  const hrs = rows.reduce((s, r) => s + (r.in && r.out ? hoursBetween(r.in, r.out) : 0), 0)
  view.innerHTML = `<div class="card"><h2>Attendance log</h2>
    <select id="m">${(months.length ? months : [cur]).map(m => `<option ${m === cur ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <div class="row"><span>Days present</span><b>${present}</b></div>
    <div class="row"><span>Total hours</span><b>${Math.round(hrs * 100) / 100}</b></div>
    <button class="btn" id="csv" style="margin-top:10px" ${rows.length ? '' : 'disabled'}>Export CSV</button></div>
    ${rows.map(r => `<div class="card"><div class="row"><b>${r.date}</b><span>${r.in ? hhmm(r.in) : '—'} → ${r.out ? hhmm(r.out) : r.in ? '<span class="bad">no check-out</span>' : '—'}</span></div>
      <div class="mut">${(r.tasks || []).filter(t => t.done).length}/${(r.tasks || []).length} tasks</div>${r.summary ? `<div>${esc(r.summary)}</div>` : ''}</div>`).join('') || '<div class="mut">No records.</div>'}`
  $('#m').onchange = e => { view.dataset.m = e.target.value; renderLog() }
  $('#csv').onclick = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([toCsv(rows.slice().reverse())], { type: 'text/csv' }))
    a.download = `swk-attendance-${cur}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
}

let Q = $ // scoped to the open tool panel while a tool runs
const num = id => parseFloat(Q(id).value) || 0
const TOOLS = {
  'Buyer cost to close': {
    html: `<label>Price (AED)<input id="p" type="number" inputmode="decimal"></label><label class="task"><input id="mo" type="checkbox"> Mortgage</label><label>Loan (AED)<input id="l" type="number" inputmode="decimal"></label>`,
    run() { const p = num('#p'), c = closingCosts(p, { mortgage: Q('#mo').checked, loan: num('#l') })
      return [['DLD 4%', c.dld], ['DLD admin', c.admin], ['Agency 2%', c.agency], ['VAT 5% on agency', c.vat], ['Mortgage registration', c.mReg], ['Total fees', c.total], ['Cash needed', c.cash]].map(([k, v]) => `<div class="row"><span>${k}</span><b>${aed(v)}</b></div>`).join('') + '<div class="mut">Indicative. Agency fee assumed 2%.</div>' }
  },
  'Mortgage': {
    html: `<label>Loan (AED)<input id="l" type="number" inputmode="decimal"></label><label>Rate % p.a.<input id="r" type="number" step="0.01" value="4.5"></label><label>Years<input id="y" type="number" value="25"></label>`,
    run() { const m = monthlyPayment(num('#l'), num('#r'), num('#y')); return `<div class="row"><span>Monthly</span><b>${aed(m)}</b></div><div class="row"><span>Total interest</span><b>${aed(m * num('#y') * 12 - num('#l'))}</b></div>` }
  },
  'Rental yield': {
    html: `<label>Price (AED)<input id="p" type="number" inputmode="decimal"></label><label>Annual rent (AED)<input id="a" type="number" inputmode="decimal"></label>`,
    run() { return `<div class="row"><span>Gross yield</span><b>${grossYield(num('#p'), num('#a'))}%</b></div>` }
  },
  'Commission split': {
    html: `<label>Sale price (AED)<input id="p" type="number" inputmode="decimal"></label><label>Commission %<input id="c" type="number" step="0.1" value="2"></label><label>Agent share %<input id="s" type="number" value="50"></label>`,
    run() { const c = commissionSplit(num('#p'), num('#c'), num('#s')); return [['Gross', c.gross], ['VAT 5%', c.vat], ['Agent', c.agent], ['Company', c.company]].map(([k, v]) => `<div class="row"><span>${k}</span><b>${aed(v)}</b></div>`).join('') }
  },
  'RERA rent increase': {
    html: `<label>Current rent (AED/yr)<input id="r" type="number" inputmode="decimal"></label><label>RERA index average (AED/yr)<input id="i" type="number" inputmode="decimal"></label>`,
    run() { const x = reraIncrease(num('#r'), num('#i')); return `<div class="row"><span>Below index</span><b>${x.below}%</b></div><div class="row"><span>Max increase</span><b>${x.pct}%</b></div><div class="row"><span>Max new rent</span><b>${aed(x.maxRent)}</b></div><div class="mut">Decree 43/2013 bands, indicative. Check the official RERA calculator and 90-day notice rule.</div>` }
  },
}
function renderTools() {
  view.innerHTML = Object.entries(TOOLS).map(([n, t], i) => `<details class="card" ${i ? '' : 'open'}><summary>${n}</summary>${t.html}<div class="out" data-n="${esc(n)}"></div></details>`).join('')
  view.querySelectorAll('details').forEach(d => {
    const t = TOOLS[d.querySelector('.out').dataset.n], out = d.querySelector('.out')
    // Inputs share ids across tools, so scope lookups to this panel.
    d.addEventListener('input', () => { Q = s => d.querySelector(s); try { out.innerHTML = t.run() } catch { out.textContent = '' } finally { Q = $ } })
  })
}

const MANUAL = [
  ['Attendance', 'Check in on arrival and check out at end of shift. Write your daily work summary before checking out. Client-based early or late appointments: note the reason in the summary.'],
  ['Daily routine', 'Review tasks each morning, log viewings and calls through the day, tick tasks as done, and submit the summary before leaving.'],
  ['Records', 'This app stores data on this device only. Export the monthly CSV and send it to your manager at month end.'],
]
function renderManual() { view.innerHTML = MANUAL.map(([h, b]) => `<div class="card"><h2>${h}</h2><div>${b}</div></div>`).join('') }

const R = { today: renderToday, log: renderLog, tools: renderTools, manual: renderManual }
function show(t) { tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); R[t]() }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => show(b.dataset.t))
const tick = () => { const d = new Date(); $('#clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}` }
tick(); setInterval(tick, 30000); show('today')
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
