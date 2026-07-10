import { describe, expect, it } from 'vitest'
import { pickTemplate, renderTemplate, requestVars, type TemplateRow } from './render'

const templates: TemplateRow[] = [
  { key: 'request_created', dept: null, subject: 'Your request {{ref}} has been received', body_html: '<p>Dear {{requester_name}},</p><p><b>{{ref}}</b> — {{title}}</p>', is_active: true },
  { key: 'request_created', dept: 'IT', subject: '[IT] {{ref}} received', body_html: '<p>{{title}} · {{service}}</p>', is_active: true },
  { key: 'resolved', dept: null, subject: '{{ref}} resolved', body_html: '<p>{{status}}</p>', is_active: false },
  { key: 'sla_warning', dept: null, subject: 'SLA warning: {{ref}} due {{sla_due}}', body_html: '<p>{{sla_due}}</p>', is_active: true },
]

describe('pickTemplate', () => {
  it('prefers the department override', () => {
    expect(pickTemplate(templates, 'request_created', 'IT')?.subject).toBe('[IT] {{ref}} received')
  })

  it('falls back to the platform default for other departments', () => {
    expect(pickTemplate(templates, 'request_created', 'PROC')?.subject)
      .toBe('Your request {{ref}} has been received')
  })

  it('returns null (skip silently) when the event switch is off', () => {
    expect(pickTemplate(templates, 'resolved', 'IT')).toBeNull()
  })

  it('returns null for an event with no template at all', () => {
    expect(pickTemplate(templates, 'assigned', 'IT')).toBeNull()
  })
})

describe('renderTemplate', () => {
  it('substitutes placeholders in subject and body', () => {
    const out = renderTemplate(templates[0], { ref: 'REQ-2500', requester_name: 'Basma', title: 'New laptop' })
    expect(out.subject).toBe('Your request REQ-2500 has been received')
    expect(out.html).toBe('<p>Dear Basma,</p><p><b>REQ-2500</b> — New laptop</p>')
  })

  it('renders unknown or missing values as empty strings', () => {
    const out = renderTemplate(
      { subject: '{{ref}} {{nope}}', body_html: '{{missing}}!' },
      { ref: 'REQ-1' },
    )
    expect(out.subject).toBe('REQ-1 ')
    expect(out.html).toBe('!')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate({ subject: '{{ ref }}', body_html: '' }, { ref: 'X' }).subject).toBe('X')
  })
})

describe('requestVars', () => {
  it('humanizes status and formats amount and sla_due', () => {
    const vars = requestVars({
      ref: 'REQ-9', title: 'T', status: 'in_progress', amount: 30000,
      requester_name: 'Basma', service: 'New hardware request',
      sla_due: '2026-07-12T08:00:00Z',
    })
    expect(vars.status).toBe('in progress')
    expect(vars.amount).toBe('30,000')
    expect(String(vars.sla_due)).toContain('12 Jul 2026')
  })

  it('passes nulls through as null (rendered empty)', () => {
    const vars = requestVars({ ref: 'R', title: null, status: null, amount: null })
    expect(vars.amount).toBeNull()
    expect(vars.sla_due).toBeNull()
  })
})
