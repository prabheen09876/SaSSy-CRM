import assert from 'node:assert/strict'
import test from 'node:test'

import { telephoneHref } from '../src/lib/phone.js'

test('creates voice-call links without guessing a country code', () => {
  const cases = [
    ['(202) 555-0181', 'tel:2025550181'],
    ['+1 (202) 555-0181', 'tel:+12025550181'],
    ['72900 07215', 'tel:7290007215'],
    ['011-2345-6789', 'tel:01123456789'],
    ['+91 72900 07215', 'tel:+917290007215'],
    ['020 7946 0958', 'tel:02079460958'],
    ['+44 (20) 7946 0958', 'tel:+442079460958'],
  ]

  for (const [input, expected] of cases) assert.equal(telephoneHref(input), expected)
})

test('strips supported display formatting and converts a 00 international prefix', () => {
  assert.equal(telephoneHref('  202.555.0181  '), 'tel:2025550181')
  assert.equal(telephoneHref('91-72900-07215'), 'tel:917290007215')
  assert.equal(telephoneHref('0044 20 7946 0958'), 'tel:+442079460958')
  assert.equal(telephoneHref('00 91 (11) 2345-6789'), 'tel:+911123456789')
  assert.equal(telephoneHref('+12025550181'), 'tel:+12025550181')
})

test('accepts plain safe integer values but rejects unknown or lossy value types', () => {
  assert.equal(telephoneHref(2025550181), 'tel:2025550181')
  assert.equal(telephoneHref(911123456789), 'tel:911123456789')

  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -2025550181,
    202.5550181,
    Number.MAX_SAFE_INTEGER + 1,
    2025550181n,
    true,
    ['2025550181'],
    { toString: () => '2025550181' },
  ]) {
    assert.equal(telephoneHref(value), '')
  }
})

test('rejects missing, too short, too long and all-zero destinations', () => {
  for (const value of [
    undefined,
    null,
    '',
    '   ',
    '123456',
    '1234567890123456',
    '+123456',
    '+1234567890123456',
    '0000000',
    '000000000000000',
    '+0000000',
    '00123456',
    '+01234567',
  ]) {
    assert.equal(telephoneHref(value), '', `expected ${String(value)} to be rejected`)
  }
})

test('rejects protocols, markup, letters, extensions, USSD and pause sequences', () => {
  for (const value of [
    'tel:+12025550181',
    'javascript:alert(1)',
    '<a href="tel:+12025550181">call</a>',
    '202 CALL NOW',
    '2025550181 ext 2',
    '2025550181 x2',
    '*123#',
    '#31#+12025550181',
    '2025550181,2',
    '2025550181;2',
  ]) {
    assert.equal(telephoneHref(value), '', `expected ${value} to be rejected`)
  }
})

test('rejects multiple or concatenated phone destinations', () => {
  for (const value of [
    '1234567 7654321',
    '2025550181 / 2025550199',
    '2025550181, 2025550199',
    '2025550181 or 2025550199',
    '2025550181\n2025550199',
    '+12025550181\r\n+12025550199',
  ]) {
    assert.equal(telephoneHref(value), '', `expected ${JSON.stringify(value)} to be rejected`)
  }
})
