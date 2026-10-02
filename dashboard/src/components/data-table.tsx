import { useState } from 'react'
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  useTable,
} from '@tanstack/react-table'
import {
  DataGrid,
  DataGridContainer,
  type DataGridFeatures,
  dataGridFeatures,
} from '@/components/reui/data-grid/data-grid'
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header'
import { DataGridPagination } from '@/components/reui/data-grid/data-grid-pagination'
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table'

// TanStack's RowData: any plain object row.
type Row = Record<string, any>

export type Column<T extends Row> = ColumnDef<DataGridFeatures, T>

const PAGE_SIZE = 50

/**
 * A sortable column. `value` is what it sorts by and shows unless `render`
 * says otherwise; `align: 'right'` for numbers.
 */
export function column<T extends Row>(
  id: string,
  title: string,
  value: (row: T) => string | number,
  opts: { render?: (row: T) => React.ReactNode; align?: 'right' } = {}
): Column<T> {
  const right = opts.align === 'right' ? 'text-right [&>div]:justify-end' : undefined
  return {
    id,
    accessorFn: value,
    header: ({ column }) => <DataGridColumnHeader title={title} column={column} />,
    cell: ({ row }) => (opts.render ?? value)(row.original),
    enableSorting: true,
    meta: { headerClassName: right, cellClassName: right },
  }
}

/**
 * ReUI data grid with sortable columns. Pages at 50 rows; the page controls
 * only appear when there's more than one page.
 */
export function DataTable<T extends Row>({
  columns,
  data,
  getRowId,
  emptyMessage,
  onRowClick,
}: {
  columns: Column<T>[]
  data: T[]
  getRowId: (row: T) => string
  emptyMessage: string
  onRowClick?: (row: T) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const table = useTable({
    features: dataGridFeatures,
    columns,
    data,
    getRowId,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  })

  return (
    <DataGrid
      table={table}
      recordCount={data.length}
      emptyMessage={emptyMessage}
      onRowClick={onRowClick}
      tableLayout={{ width: 'auto' }}
    >
      <div className='grid gap-2.5'>
        <DataGridContainer>
          <DataGridTable />
        </DataGridContainer>
        {data.length > PAGE_SIZE && (
          // Page size is fixed, so hide ReUI's rows-per-page picker (first child).
          <DataGridPagination sizes={[PAGE_SIZE]} className='*:first:hidden' />
        )}
      </div>
    </DataGrid>
  )
}
