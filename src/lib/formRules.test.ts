import { describe, expect, it } from 'vitest'
import { effectiveFields, evalField, ruleHolds, type FieldRule, type RuledField } from './formRules'

const rule = (over: Partial<FieldRule>): FieldRule =>
  ({ when: 'src', op: 'eq', value: 'x', effect: 'show', ...over })

describe('ruleHolds — operators', () => {
  it('eq / neq compare stringified values (booleans included)', () => {
    expect(ruleHolds(rule({ op: 'eq', value: 'Temporary' }), { src: 'Temporary' })).toBe(true)
    expect(ruleHolds(rule({ op: 'eq', value: true }), { src: true })).toBe(true)
    expect(ruleHolds(rule({ op: 'eq', value: 'true' }), { src: true })).toBe(true)
    expect(ruleHolds(rule({ op: 'neq', value: 'A' }), { src: 'B' })).toBe(true)
    expect(ruleHolds(rule({ op: 'neq', value: 'A' }), { src: 'A' })).toBe(false)
  })

  it('gte / lte compare numerically and fail on non-numeric operands', () => {
    expect(ruleHolds(rule({ op: 'gte', value: 25000 }), { src: '25000' })).toBe(true)
    expect(ruleHolds(rule({ op: 'gte', value: 25000 }), { src: '24999' })).toBe(false)
    expect(ruleHolds(rule({ op: 'lte', value: 10 }), { src: '10' })).toBe(true)
    expect(ruleHolds(rule({ op: 'gte', value: 25000 }), { src: 'abc' })).toBe(false)
    expect(ruleHolds(rule({ op: 'gte', value: 25000 }), {})).toBe(false)
  })

  it('in matches membership of an array value', () => {
    expect(ruleHolds(rule({ op: 'in', value: ['A', 'B'] }), { src: 'B' })).toBe(true)
    expect(ruleHolds(rule({ op: 'in', value: ['A', 'B'] }), { src: 'C' })).toBe(false)
    expect(ruleHolds(rule({ op: 'in', value: 'not-an-array' }), { src: 'A' })).toBe(false)
  })
})

describe('evalField — show vs require', () => {
  const keys = new Set(['duration', 'amount', 'end_date', 'cc'])

  it('show rule hides the field until the condition holds', () => {
    const f: RuledField = { key: 'end_date', rules: [rule({ when: 'duration', value: 'Temporary', effect: 'show' })] }
    expect(evalField(f, { duration: 'Permanent' }, keys).visible).toBe(false)
    expect(evalField(f, { duration: 'Temporary' }, keys).visible).toBe(true)
  })

  it('require rule makes an optional field mandatory only when the condition holds', () => {
    const f: RuledField = { key: 'cc', rules: [rule({ when: 'amount', op: 'gte', value: 25000, effect: 'require' })] }
    expect(evalField(f, { amount: '30000' }, keys).required).toBe(true)
    expect(evalField(f, { amount: '10000' }, keys).required).toBe(false)
  })

  it('a hidden field is never required, even with a holding require rule', () => {
    const f: RuledField = {
      key: 'end_date',
      rules: [
        rule({ when: 'duration', value: 'Temporary', effect: 'show' }),
        rule({ when: 'duration', value: 'Temporary', effect: 'require' }),
      ],
    }
    expect(evalField(f, { duration: 'Permanent' }, keys)).toEqual({ visible: false, required: false })
    expect(evalField(f, { duration: 'Temporary' }, keys)).toEqual({ visible: true, required: true })
  })

  it('chained conditions: all show rules must hold', () => {
    const f: RuledField = {
      key: 'cc',
      rules: [
        rule({ when: 'duration', value: 'Temporary', effect: 'show' }),
        rule({ when: 'amount', op: 'gte', value: 1000, effect: 'show' }),
      ],
    }
    expect(evalField(f, { duration: 'Temporary', amount: '999' }, keys).visible).toBe(false)
    expect(evalField(f, { duration: 'Temporary', amount: '1000' }, keys).visible).toBe(true)
  })

  it('rules referencing unknown source fields are inert', () => {
    const f: RuledField = {
      key: 'cc', required: false,
      rules: [rule({ when: 'ghost', value: 'x', effect: 'show' }), rule({ when: 'ghost', effect: 'require' })],
    }
    expect(evalField(f, {}, keys)).toEqual({ visible: true, required: false })
  })

  it('static flags still apply: visible=false wins, required=true stays', () => {
    expect(evalField({ key: 'cc', visible: false }, {}, keys).visible).toBe(false)
    expect(evalField({ key: 'cc', required: true }, {}, keys).required).toBe(true)
  })
})

describe('effectiveFields', () => {
  it('drops hidden fields and applies effective required', () => {
    const fields: RuledField[] = [
      { key: 'duration' },
      { key: 'end_date', rules: [
        rule({ when: 'duration', value: 'Temporary', effect: 'show' }),
        rule({ when: 'duration', value: 'Temporary', effect: 'require' }),
      ] },
    ]
    expect(effectiveFields(fields, { duration: 'Permanent' }).map((f) => f.key)).toEqual(['duration'])
    const eff = effectiveFields(fields, { duration: 'Temporary' })
    expect(eff.map((f) => f.key)).toEqual(['duration', 'end_date'])
    expect(eff[1].required).toBe(true)
  })
})
