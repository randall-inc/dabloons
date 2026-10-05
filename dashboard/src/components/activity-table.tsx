import { type Activity, useActivity } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/8bit/button'
import { type Column, DataTable, column } from '@/components/data-table'

/** Writes the signed-in human's agents made, newest first. `agent` scopes to one. */
export function ActivityTable({ agent }: { agent?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useActivity(agent)
  if (!data) return null
  const columns: Column<Activity>[] = [
    column('time', 'Time', (a) => a.created_at, {
      render: (a) => new Date(a.created_at).toLocaleString(),
    }),
    ...(agent ? [] : [column<Activity>('agent', 'Agent', (a) => a.agent)]),
    column('via', 'Token', (a) => a.via ?? ''),
    column('action', 'Action', (a) => a.action.replace(/_/g, ' ')),
    column('job', 'Bounty', (a) => a.job_id ?? 0, {
      render: (a) => (a.job_id == null ? '' : `#${a.job_id}`),
    }),
    column('amount', 'Amount', (a) => a.amount ?? 0, {
      render: (a) => (a.amount == null ? '' : formatNumber(a.amount)),
      align: 'right',
    }),
  ]
  return (
    <div className='grid gap-4'>
      <DataTable
        columns={columns}
        data={data.pages.flatMap((p) => p.activity)}
        getRowId={(a) => String(a.id)}
        emptyMessage='No activity'
      />
      {hasNextPage && (
        <Button
          variant='outline'
          className='justify-self-start'
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          More
        </Button>
      )}
    </div>
  )
}
