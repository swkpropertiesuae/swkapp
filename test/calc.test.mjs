import assert from 'node:assert/strict'
import { closingCosts, monthlyPayment, grossYield, commissionSplit, reraIncrease, toCsv, hoursBetween } from '../public/calc.js'

const c = closingCosts(1_000_000)
assert.equal(c.dld, 40000); assert.equal(c.agency, 20000); assert.equal(c.vat, 1000); assert.equal(c.total, 61580)
assert.equal(closingCosts(1_000_000, { mortgage: true, loan: 800000 }).mReg, 2290)
assert.equal(monthlyPayment(120000, 0, 10), 1000)
assert.equal(monthlyPayment(1_000_000, 5, 25), 5845.9)
assert.equal(grossYield(1_000_000, 70000), 7)
assert.deepEqual(commissionSplit(1_000_000, 2, 50), { gross: 20000, vat: 1000, agent: 10000, company: 10000 })
assert.equal(reraIncrease(80, 100).pct, 5); assert.equal(reraIncrease(100, 100).pct, 0); assert.equal(reraIncrease(65, 100).pct, 15)
assert.equal(hoursBetween('2026-01-01T09:00:00Z', '2026-01-01T17:30:00Z'), 8.5)
assert.match(toCsv([{ date: '2026-01-01', in: '2026-01-01T09:00:00Z', out: '2026-01-01T17:00:00Z', summary: 'a, "b"', tasks: [{ text: 'x', done: true }] }]), /"a, ""b"""/)
console.log('ok')
import { weekKeys } from '../public/calc.js'
const w = weekKeys(new Date(2026, 10, 17)) // Tue
assert.equal(w[0], '2026-11-16'); assert.equal(w[6], '2026-11-22')
console.log('week ok')
