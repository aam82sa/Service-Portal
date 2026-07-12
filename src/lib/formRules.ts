/**
 * Show/require-if rules for form fields — pure evaluator shared by the
 * request form (live) and mirrored by the SQL submission validator
 * (migration 00050). Semantics:
 *
 * - a field with `show` rules is visible only while ALL of them hold
 *   (on top of the static `visible` flag)
 * - a field is required when its static `required` flag is set OR any
 *   `require` rule holds — and only while the field is visible
 * - a rule whose `when` key is not a field of the form is inert (ignored)
 * - eq/neq compare stringified values; gte/lte compare numerically
 *   (non-numeric operands make the rule fail); `in` expects an array value
 */

export interface FieldRule {
  when: string
  op: 'eq' | 'neq' | 'gte' | 'lte' | 'in'
  value: unknown
  effect: 'show' | 'require'
}

export interface RuledField {
  key: string
  visible?: boolean
  required?: boolean
  rules?: FieldRule[]
}

export type RuleValues = Record<string, unknown>

const str = (v: unknown): string =>
  v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(str).join(',') : String(v)

export function ruleHolds(rule: FieldRule, values: RuleValues): boolean {
  const v = values[rule.when]
  switch (rule.op) {
    case 'eq': return str(v) === str(rule.value)
    case 'neq': return str(v) !== str(rule.value)
    case 'gte': {
      const a = Number(str(v)); const b = Number(str(rule.value))
      return Number.isFinite(a) && Number.isFinite(b) && a >= b
    }
    case 'lte': {
      const a = Number(str(v)); const b = Number(str(rule.value))
      return Number.isFinite(a) && Number.isFinite(b) && a <= b
    }
    case 'in':
      return Array.isArray(rule.value) && rule.value.map(str).includes(str(v))
    default:
      return false
  }
}

export interface FieldState {
  visible: boolean
  required: boolean
}

/** Effective visibility/required for one field given current values. */
export function evalField<F extends RuledField>(
  field: F,
  values: RuleValues,
  knownKeys: Set<string>,
): FieldState {
  const active = (field.rules ?? []).filter((r) => knownKeys.has(r.when)) // unknown source = inert
  const showRules = active.filter((r) => r.effect === 'show')
  const visible = field.visible !== false && showRules.every((r) => ruleHolds(r, values))
  const required = visible && (
    Boolean(field.required) || active.some((r) => r.effect === 'require' && ruleHolds(r, values))
  )
  return { visible, required }
}

/** All fields with effective flags applied; hidden fields are dropped. */
export function effectiveFields<F extends RuledField>(fields: F[], values: RuleValues): F[] {
  const keys = new Set(fields.map((f) => f.key))
  return fields
    .map((f) => ({ f, state: evalField(f, values, keys) }))
    .filter(({ state }) => state.visible)
    .map(({ f, state }) => ({ ...f, visible: true, required: state.required }))
}
