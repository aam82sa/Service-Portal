/**
 * Client-side metadata for the dashboard builder's palette and properties
 * pane. The vocabulary here (sources, groupable columns) must match the edge
 * allowlist — builderMeta.parity.test.ts imports both and asserts it — and
 * the widget-type list must match the 00088 CHECK constraint (same test).
 */

export interface SourceMeta {
  key: string
  label: string
  ico: string
  /** columns offered in "Group by" — must be ⊆ the allowlist's groupable */
  groupable: { key: string; label: string }[]
  /** aggregations offered as "Measure" */
  measures: { key: string; label: string; fn: 'count' | 'sum' | 'avg'; col?: string }[]
  personalData?: boolean
  /** fixed-shape sources compile wholesale — no group/measure/filter picking */
  fixed?: boolean
  /**
   * the filterable date column a period bound compiles against; null = the
   * source has no date filter, so widget periods are silently dropped
   * (the parity test asserts non-null values are allowlist date filters)
   */
  periodCol?: string | null
  /** columns a widget filter may bind — must be ⊆ the allowlist's filterable */
  filterable?: string[]
}

const countOnly: SourceMeta['measures'] = [{ key: 'count', label: 'Count of rows', fn: 'count' }]

export const SOURCE_META: SourceMeta[] = [
  {
    key: 'requests', label: 'Requests', ico: 'Rq', periodCol: 'created_at',
    filterable: ['dept', 'service_code', 'status', 'priority'],
    groupable: [
      { key: 'service_code', label: 'Service' },
      { key: 'dept', label: 'Department' },
      { key: 'priority', label: 'Priority' },
      { key: 'status', label: 'Status' },
    ],
    measures: [
      { key: 'count', label: 'Count of requests', fn: 'count' },
      { key: 'sum_amount', label: 'Sum of amount (SAR)', fn: 'sum', col: 'amount' },
      { key: 'avg_amount', label: 'Avg amount (SAR)', fn: 'avg', col: 'amount' },
    ],
  },
  {
    key: 'sla', label: 'SLA', ico: 'SL', periodCol: 'created_at',
    filterable: ['dept', 'service_code', 'status', 'priority'],
    groupable: [
      { key: 'dept', label: 'Department' },
      { key: 'priority', label: 'Priority' },
      { key: 'status', label: 'Status' },
      { key: 'service_code', label: 'Service' },
    ],
    measures: countOnly,
  },
  {
    key: 'assets', label: 'Assets', ico: 'As', periodCol: 'purchased_on',
    filterable: ['category', 'status'],
    groupable: [
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'location', label: 'Location' },
      { key: 'manufacturer', label: 'Manufacturer' },
    ],
    measures: [
      { key: 'count', label: 'Count of assets', fn: 'count' },
      { key: 'sum_cost', label: 'Sum of cost (SAR)', fn: 'sum', col: 'cost' },
    ],
  },
  {
    key: 'pmo_projects', label: 'Projects', ico: 'Pr', periodCol: null,
    filterable: ['status', 'department_scope'],
    groupable: [
      { key: 'status', label: 'Status' },
      { key: 'department_scope', label: 'Department scope' },
      { key: 'project_type', label: 'Project type' },
    ],
    measures: countOnly,
  },
  {
    key: 'pmo_risks', label: 'Risks', ico: 'Ri', periodCol: 'created_at',
    filterable: ['category', 'type', 'status'],
    groupable: [
      { key: 'category', label: 'Category' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'project_code', label: 'Project' },
    ],
    measures: [
      { key: 'count', label: 'Count of risks', fn: 'count' },
      { key: 'avg_score', label: 'Avg risk score', fn: 'avg', col: 'score' },
    ],
  },
  {
    key: 'letters', label: 'Letters', ico: 'Lt', periodCol: null,
    filterable: ['direction', 'dept', 'status', 'confidentiality'],
    groupable: [
      { key: 'direction', label: 'Direction' },
      { key: 'dept', label: 'Department' },
      { key: 'status', label: 'Status' },
      { key: 'confidentiality', label: 'Confidentiality' },
    ],
    measures: countOnly,
  },
  {
    key: 'audit', label: 'Audit', ico: 'Au', periodCol: 'created_at',
    filterable: ['area', 'action'],
    groupable: [
      { key: 'area', label: 'Area' },
      { key: 'action', label: 'Action' },
    ],
    measures: countOnly,
  },
  { key: 'dept_performance', label: 'Dept performance', ico: 'DP', groupable: [], measures: [], fixed: true },
  {
    key: 'employee_performance', label: 'Employee perf.', ico: 'EP',
    groupable: [], measures: [], fixed: true, personalData: true,
  },
]

export const sourceMeta = (key: string): SourceMeta =>
  SOURCE_META.find((s) => s.key === key) ?? SOURCE_META[0]

/** the builder palette — must equal the 00088 widget_type CHECK */
export const WIDGET_TYPES = ['kpi', 'line', 'bar', 'donut', 'stacked', 'table', 'pivot'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]

export const WIDGET_ICO: Record<WidgetType, string> = {
  kpi: '#', line: '↗', bar: '▬', donut: '◎', stacked: '▨', table: '⊞', pivot: '⋁',
}
export const WIDGET_LABEL: Record<WidgetType, string> = {
  kpi: 'KPI card', line: 'Line', bar: 'Bar', donut: 'Donut', stacked: 'Stacked', table: 'Table', pivot: 'Pivot',
}
