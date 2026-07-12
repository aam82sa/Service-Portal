/**
 * Render smoke test: the form renders a control for every field type without
 * touching the network (supabase + auth are mocked; server render skips
 * effects).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) }) },
}))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile: null, hasRole: () => false }),
}))
vi.mock('../../components/FileUpload', () => ({
  FileUpload: () => <div data-type="attachment">upload-zone</div>,
}))

import { RequestForm, type FormField } from './RequestForm'

const service = {
  id: 's1', dept: 'IT' as const, code: 'XX-01', name: 'Smoke service', description: 'desc',
  form_schema: [
    { key: 'a', label: 'Text A', type: 'text', required: true },
    { key: 'b', label: 'Yes or no', type: 'yesno' },
    { key: 'c', label: 'Cost center', type: 'costcenter' },
    { key: 'd', label: 'Attachment', type: 'attachment' },
    { key: 'e', label: 'My asset', type: 'asset_picker' },
    { key: 'f', label: 'Person', type: 'employee_picker' },
    { key: 'g', label: 'Pick one', type: 'dropdown', options: ['One', 'Two'] },
    { key: 'h', label: 'Hidden', type: 'text', visible: false },
  ] as FormField[],
}

describe('RequestForm render smoke', () => {
  it('renders every visible field type once and skips hidden fields', () => {
    // service shape is structurally sufficient for the component
    const html = renderToStaticMarkup(
      <RequestForm service={service as never} onDone={() => undefined} />,
    )
    expect(html).toContain('Text A')
    expect(html).toContain('Yes or no')
    expect(html).toContain('Cost center')
    expect(html).toContain('upload-zone')
    expect(html).toContain('My asset')
    expect(html).toContain('Person')
    expect(html).toContain('Pick one')
    expect(html).not.toContain('Hidden')
    expect(html).toContain('Submit request')
  })
})
