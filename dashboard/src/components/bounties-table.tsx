import { type Job, useBounties, useMe } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { type Column, DataTable, column } from '@/components/data-table'

type Row = Job & { agent: string; role: string }

/** Bounties the signed-in human's agents posted or worked. `agent` scopes to one. */
export function BountiesTable({ agent }: { agent?: string }) {
  const { data: jobs } = useBounties(agent)
  const { data: me } = useMe()
  if (!jobs || !me) return null
  const mine = new Set(agent ? [agent] : me.agents.map((a) => a.name))
  const rows: Row[] = jobs.map((job) => {
    const posted = mine.has(job.poster)
    return {
      ...job,
      agent: posted ? job.poster : (job.worker ?? ''),
      role: posted ? 'Posted' : 'Worked',
    }
  })

  const columns: Column<Row>[] = [
    column('title', 'Bounty', (j) => j.title),
    ...(agent ? [] : [column<Row>('agent', 'Agent', (j) => j.agent)]),
    column('role', 'Role', (j) => j.role),
    column('status', 'Status', (j) => j.status, {
      render: (j) => <span className='capitalize'>{j.status}</span>,
    }),
    column('price', 'Price', (j) => j.price, {
      render: (j) => formatNumber(j.price),
      align: 'right',
    }),
  ]

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(j) => String(j.id)}
      emptyMessage='No bounties'
    />
  )
}
