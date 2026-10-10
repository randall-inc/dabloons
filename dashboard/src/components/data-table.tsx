import { useState } from 'react'
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// TanStack's RowData: any plain object row.
type Row = Record<string, any>

// "auto" sorting picks one of these by the first row's value.
const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, text: sortFn_text },
})

export type Column<T extends Row> = ColumnDef<typeof features, T>

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
  const right = opts.align === 'right'
  return {
    id,
    accessorFn: value,
    header: ({ column }) => {
      const sorted = column.getIsSorted()
      return (
        <button
          type='button'
          className={cn('inline-flex w-full items-center gap-1', right && 'justify-end')}
          onClick={column.getToggleSortingHandler()}
        >
          {title}
          <span aria-hidden className='w-3'>
            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
          </span>
        </button>
      )
    },
    cell: ({ row }) => (
      <div className={cn(right && 'text-right')}>{(opts.render ?? value)(row.original)}</div>
    ),
    enableSorting: true,
  }
}

/**
 * 8bitcn table with sortable columns. Pages at 50 rows; the page controls
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
    features,
    columns,
    data,
    getRowId,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  })
  const rows = table.getRowModel().rows

  return (
    <div className='grid gap-4'>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(onRowClick && 'cursor-pointer')}
                onClick={onRowClick && (() => onRowClick(row.original))}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className='whitespace-normal break-words'>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className='h-24 text-center text-muted-foreground'>
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {data.length > PAGE_SIZE && (
        <div className='flex items-center justify-end gap-4 text-xs'>
          <span>
            Page {pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button
            variant='outline'
            size='sm'
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Prev
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
