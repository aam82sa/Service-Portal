import { describe, expect, it } from 'vitest'
import { validateSubmission, type FormFieldLike } from './formValidate'

const field = (over: Partial<FormFieldLike>): FormFieldLike => ({
  key: 'f', label: 'Field', type: 'text', ...over,
})

describe('validateSubmission — required presence', () => {
  it('flags missing/blank required values of every scalar type', () => {
    for (const type of ['text', 'longtext', 'number', 'amount', 'date', 'dropdown', 'costcenter', 'asset_picker', 'employee_picker']) {
      expect(validateSubmission([field({ type, required: true })], {})).toHaveLength(1)
      expect(validateSubmission([field({ type, required: true })], { f: '  ' })).toHaveLength(1)
    }
  })

  it('requires at least one file for a required attachment', () => {
    const fields = [field({ type: 'attachment', required: true })]
    expect(validateSubmission(fields, { f: [] })).toHaveLength(1)
    expect(validateSubmission(fields, { f: ['req/1-a.pdf'] })).toHaveLength(0)
  })

  it('required yesno is satisfied by an explicit false (toggle always answers)', () => {
    expect(validateSubmission([field({ type: 'yesno', required: true })], { f: false })).toHaveLength(0)
    expect(validateSubmission([field({ type: 'yesno', required: true })], { f: true })).toHaveLength(0)
  })

  it('ignores hidden fields entirely', () => {
    expect(validateSubmission([field({ required: true, visible: false })], {})).toHaveLength(0)
  })

  it('optional blank values pass', () => {
    expect(validateSubmission([field({})], { f: '' })).toHaveLength(0)
  })
})

describe('validateSubmission — type rules', () => {
  it('yesno rejects non-boolean noise', () => {
    expect(validateSubmission([field({ type: 'yesno' })], { f: 'maybe' })).toHaveLength(1)
    expect(validateSubmission([field({ type: 'yesno' })], { f: 'true' })).toHaveLength(0)
  })

  it('costcenter must be in the active list when the list is loaded', () => {
    const fields = [field({ type: 'costcenter' })]
    const ctx = { costCenters: ['CC-IT-01', 'CC-GEN-01'] }
    expect(validateSubmission(fields, { f: 'CC-IT-01' }, ctx)).toHaveLength(0)
    expect(validateSubmission(fields, { f: 'CC-NOPE' }, ctx)).toHaveLength(1)
    // without the list loaded the check is deferred to the server
    expect(validateSubmission(fields, { f: 'CC-NOPE' })).toHaveLength(0)
  })

  it("asset_picker must be one of the requester's assets", () => {
    const fields = [field({ type: 'asset_picker' })]
    const ctx = { ownedAssetIds: ['a1', 'a2'] }
    expect(validateSubmission(fields, { f: 'a1' }, ctx)).toHaveLength(0)
    expect(validateSubmission(fields, { f: 'stolen' }, ctx)).toHaveLength(1)
  })

  it('employee_picker must reference a known profile when loaded', () => {
    const fields = [field({ type: 'employee_picker' })]
    expect(validateSubmission(fields, { f: 'p9' }, { profileIds: ['p1'] })).toHaveLength(1)
    expect(validateSubmission(fields, { f: 'p1' }, { profileIds: ['p1'] })).toHaveLength(0)
  })

  it('dropdown values must be one of the configured options', () => {
    const fields = [field({ type: 'dropdown', options: ['A', 'B'] })]
    expect(validateSubmission(fields, { f: 'A' })).toHaveLength(0)
    expect(validateSubmission(fields, { f: 'C' })).toHaveLength(1)
  })

  it('attachment value must be an array', () => {
    expect(validateSubmission([field({ type: 'attachment' })], { f: 'not-a-list' })).toHaveLength(1)
  })
})
