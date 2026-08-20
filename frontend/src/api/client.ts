import http from '@/api/http'
import type {
  APIResponse,
  HealthData,
  DatabaseStatusData,
  SchemaListData,
  TableListData,
  ViewListData,
  ColumnListData,
  SearchData,
  StoreData,
  PreviewData,
} from '@/types/api'

export const api = {
  // ── Health (Phase 1) ──────────────────────────────────────────────────────
  health: (): Promise<APIResponse<HealthData>> =>
    http.get<APIResponse<HealthData>>('/health').then(r => r.data),

  // ── Database (Phase 2) ────────────────────────────────────────────────────
  databaseStatus: (): Promise<APIResponse<DatabaseStatusData>> =>
    http.get<APIResponse<DatabaseStatusData>>('/database/status').then(r => r.data),

  schemas: (): Promise<APIResponse<SchemaListData>> =>
    http.get<APIResponse<SchemaListData>>('/database/schemas').then(r => r.data),

  tables: (owner?: string): Promise<APIResponse<TableListData>> =>
    http
      .get<APIResponse<TableListData>>('/database/tables', {
        params: owner ? { owner } : {},
      })
      .then(r => r.data),

  views: (owner?: string): Promise<APIResponse<ViewListData>> =>
    http
      .get<APIResponse<ViewListData>>('/database/views', {
        params: owner ? { owner } : {},
      })
      .then(r => r.data),

  tableColumns: (owner: string, tableName: string): Promise<APIResponse<ColumnListData>> =>
    http
      .get<APIResponse<ColumnListData>>(`/database/table/${owner}/${tableName}/columns`)
      .then(r => r.data),

  viewColumns: (owner: string, viewName: string): Promise<APIResponse<ColumnListData>> =>
    http
      .get<APIResponse<ColumnListData>>(`/database/view/${owner}/${viewName}/columns`)
      .then(r => r.data),

  searchObjects: (
    q: string,
    opts?: { owner?: string; object_type?: string; limit?: number },
  ): Promise<APIResponse<SearchData>> =>
    http
      .get<APIResponse<SearchData>>('/database/search', {
        params: { q, ...opts },
      })
      .then(r => r.data),

  // ── Master Data (Phase 3 / 4) ─────────────────────────────────────────────
  masterStores: (activeOnly = true): Promise<APIResponse<StoreData>> =>
    http
      .get<APIResponse<StoreData>>('/master/stores', { params: { active_only: activeOnly } })
      .then(r => r.data),

  masterList: (
    endpoint: 'seasons' | 'attributes' | 'divisions' | 'sections' | 'departments' | 'articles' | 'store-grades' | 'zones',
    params?: Record<string, string | undefined>,
  ): Promise<APIResponse<Record<string, string[]>>> =>
    http
      .get<APIResponse<Record<string, string[]>>>(`/master/${endpoint}`, {
        params: params
          ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
          : {},
      })
      .then(r => r.data),

  previewSales: (params?: {
    department?: string
    store_name?: string
    limit?: number
  }): Promise<APIResponse<PreviewData>> =>
    http
      .get<APIResponse<PreviewData>>('/master/preview/sales', { params, timeout: 90_000 })
      .then(r => r.data),

  previewStock: (params?: {
    department?: string
    store_name?: string
    limit?: number
  }): Promise<APIResponse<PreviewData>> =>
    http
      .get<APIResponse<PreviewData>>('/master/preview/stock', { params, timeout: 60_000 })
      .then(r => r.data),

  previewMdq: (params?: {
    division?: string
    department?: string
    limit?: number
  }): Promise<APIResponse<PreviewData>> =>
    http
      .get<APIResponse<PreviewData>>('/master/preview/mdq', { params, timeout: 30_000 })
      .then(r => r.data),
}
