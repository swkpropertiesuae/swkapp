// Pure helpers (no DOM) so they can be tested with node.
export const r2 = n => Math.round(n * 100) / 100

// DLD 4% + AED 580 admin; agency commission 2% + 5% VAT; mortgage registration 0.25% of loan + AED 290.
export function closingCosts(price, { mortgage = false, loan = 0 } = {}) {
  const dld = price * 0.04, admin = 580
  const agency = price * 0.02, vat = agency * 0.05
  const mReg = mortgage ? loan * 0.0025 + 290 : 0
  const total = dld + admin + agency + vat + mReg
  return { dld: r2(dld), admin, agency: r2(agency), vat: r2(vat), mReg: r2(mReg), total: r2(total), cash: r2(price + total) }
}

export function monthlyPayment(loan, ratePct, years) {
  const n = years * 12, i = ratePct / 100 / 12
  if (n <= 0) return 0
  return r2(i === 0 ? loan / n : (loan * i) / (1 - Math.pow(1 + i, -n)))
}

export function grossYield(price, annualRent) { return price > 0 ? r2((annualRent / price) * 100) : 0 }

export function commissionSplit(price, pct, agentSharePct) {
  const gross = price * pct / 100, vat = gross * 0.05
  const agent = gross * agentSharePct / 100
  return { gross: r2(gross), vat: r2(vat), agent: r2(agent), company: r2(gross - agent) }
}

// Dubai Decree 43/2013 bands (indicative): how far current rent sits below the RERA index average.
export function reraIncrease(rent, index) {
  const below = index > 0 ? ((index - rent) / index) * 100 : 0
  const pct = below <= 10 ? 0 : below <= 20 ? 5 : below <= 30 ? 10 : below <= 40 ? 15 : 20
  return { below: r2(Math.max(0, below)), pct, maxRent: r2(rent * (1 + pct / 100)) }
}

export const pad = n => String(n).padStart(2, '0')
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const hhmm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
export const hoursBetween = (a, b) => r2((new Date(b) - new Date(a)) / 36e5)

export function csvEscape(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export function toCsv(rows) {
  const head = ['Date', 'Check in', 'Check out', 'Hours', 'Location', 'Tasks done', 'Summary']
  const body = rows.map(r => [r.date, r.in ? hhmm(r.in) : '', r.out ? hhmm(r.out) : '',
    r.in && r.out ? hoursBetween(r.in, r.out) : '', r.loc || '',
    (r.tasks || []).filter(t => t.done).map(t => t.text).join('; '), r.summary || ''])
  return [head, ...body].map(l => l.map(csvEscape).join(',')).join('\n')
}
