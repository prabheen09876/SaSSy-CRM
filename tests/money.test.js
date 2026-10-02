import test from 'node:test'
import assert from 'node:assert/strict'
import { totalsByCurrency, recordCurrency } from '../src/lib/money.js'

test('pipeline totals keep unlike currencies separate and use the workspace currency only when missing', () => {
  assert.deepEqual(totalsByCurrency([
    { budget: 500, currency: 'INR' },
    { budget: 200, currency: 'USD' },
    { budget: '25.5', currency: 'usd' },
    { budget: 100 },
    { budget: '' }, { budget: null }, { budget: -1 }, { budget: 'invalid' },
  ], 'INR'), [['INR', 600], ['USD', 225.5]])
  assert.equal(recordCurrency({ currency: ' eur ' }, 'INR'), 'EUR')
  assert.equal(recordCurrency({ currency: 'invalid' }, 'INR'), 'INR')
})
