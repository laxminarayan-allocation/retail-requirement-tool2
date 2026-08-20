// ── Generic envelope ──────────────────────────────────────────────────────────
export interface APIResponse<T = unknown> {
  success: boolean
  data: T | null
  message: string | null
  errors: string[]
}

// ── Health / status ───────────────────────────────────────────────────────────
export interface HealthData {
  status: string
  version: string
  environment: string
}

export interface DatabaseStatusData {
  status: string
  database: string
  db_schema: string | null
  oracle_version: string | null
  response_time_ms: number | null
  message: string | null
}

// ── Database Explorer — Phase 2 ───────────────────────────────────────────────
export interface SchemaRow {
  owner: string
}

export interface TableRow {
  owner: string
  table_name: string
  num_rows: number | null
  last_analyzed: string | null
  comments: string | null
}

export interface ViewRow {
  owner: string
  view_name: string
  comments: string | null
}

export interface ColumnRow {
  column_id: number
  column_name: string
  data_type: string
  data_length: number | null
  data_precision: number | null
  data_scale: number | null
  nullable: string
  data_default: string | null
  comments: string | null
}

export interface SchemaListData {
  schemas: SchemaRow[]
  count: number
}

export interface TableListData {
  tables: TableRow[]
  count: number
  query_ms: number
}

export interface ViewListData {
  views: ViewRow[]
  count: number
  query_ms: number
}

export interface ColumnListData {
  owner: string
  table_name?: string
  view_name?: string
  columns: ColumnRow[]
  column_count: number
  row_estimate?: number | null
  query_ms: number
}

export interface SearchResult {
  owner: string
  object_name: string
  object_type: string
  status: string
  last_ddl_time: string | null
}

export interface SearchData {
  results: SearchResult[]
  count: number
}

// ── Master Data — Phase 3 / 4 ─────────────────────────────────────────────────

export interface StoreRecord {
  store_name: string
  zone: string | null
  grade: string | null
  city: string | null
  state: string | null
  store_status: string | null
  open_date: string | null
}

export interface StoreData {
  stores: StoreRecord[]
  count: number
  query_ms: number
}

export interface PreviewRow {
  [key: string]: string | number | null
}

export interface PreviewData {
  rows: PreviewRow[]
  total_rows: number
  query_ms: number
}

export interface MasterFiltersData {
  attribute1?: string | null
  season?: string | null
  division?: string | null
  department?: string | null
}
