/**
 * Client-side submission validation — the TypeScript mirror of
 * validate_request_payload() (migration 00049). The server re-checks
 * everything; this gives instant feedback and is what the unit tests pin.
 *
 * Structural field type to avoid a cycle with RequestForm's FormField
 * (which is assignable to this).
 */

export interface FormFieldLike {
  key: string
  label: string
  type: string
  options?: string[]
  visible?: boolean
  required?: boolean
}

export type FieldValue = string | boolean | string[] | null | undefined

export interface ValidationContext {
  /** active cost-center codes, when loaded */
  costCenters?: string[]
  /** ids of assets assigned to the requester, when loaded */
  ownedAssetIds?: string[]
  /** known profile ids, when loaded */
  profileIds?: string[]
}

export interface FieldProblem {
  key: string
  label: string
  reason: string
}

const isBlank = (v: FieldValue) =>
  v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

export function validateSubmission(
  fields: FormFieldLike[],
  values: Record<string, FieldValue>,
  ctx: ValidationContext = {},
): FieldProblem[] {
  const problems: FieldProblem[] = []
  for (const f of fields) {
    if (f.visible === false) continue
    const v = values[f.key]

    if (f.required && isBlank(v) && f.type !== 'yesno') {
      problems.push({ key: f.key, label: f.label, reason: 'This field is required' })
      continue
    }
    if (isBlank(v)) continue

    switch (f.type) {
      case 'yesno':
        if (typeof v !== 'boolean' && v !== 'true' && v !== 'false') {
          problems.push({ key: f.key, label: f.label, reason: 'Must be yes or no' })
        }
        break
      case 'costcenter':
        if (ctx.costCenters && !ctx.costCenters.includes(String(v))) {
          problems.push({ key: f.key, label: f.label, reason: 'Unknown or inactive cost center' })
        }
        break
      case 'attachment':
        if (!Array.isArray(v)) {
          problems.push({ key: f.key, label: f.label, reason: 'Attachment list expected' })
        }
        break
      case 'asset_picker':
        if (ctx.ownedAssetIds && !ctx.ownedAssetIds.includes(String(v))) {
          problems.push({ key: f.key, label: f.label, reason: 'Pick one of your assigned assets' })
        }
        break
      case 'employee_picker':
        if (ctx.profileIds && !ctx.profileIds.includes(String(v))) {
          problems.push({ key: f.key, label: f.label, reason: 'Unknown employee' })
        }
        break
      case 'dropdown':
        if (f.options && f.options.length > 0 && !f.options.includes(String(v))) {
          problems.push({ key: f.key, label: f.label, reason: 'Pick one of the listed options' })
        }
        break
    }
  }
  return problems
}
