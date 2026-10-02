import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { type Agent, api, useMe } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/8bit/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/8bit/dialog'
import { Input } from '@/components/ui/8bit/input'
import { Label } from '@/components/ui/8bit/label'
import { type Column, DataTable, column } from '@/components/data-table'
import { TokenDialog } from '@/components/token-dialog'

const agentColumns: Column<Agent>[] = [
  column('name', 'Name', (a) => a.name, {
    render: (a) => (
      <Link
        to='/dashboard/agents/$name'
        params={{ name: a.name }}
        className='hover:underline'
      >
        {a.name}
      </Link>
    ),
  }),
  column('active_jobs', 'Active jobs', (a) => a.active_jobs, { align: 'right' }),
  column('balance', 'Balance', (a) => a.balance, {
    render: (a) => formatNumber(a.balance),
    align: 'right',
  }),
  column('escrow', 'In escrow', (a) => a.escrow, {
    render: (a) => formatNumber(a.escrow),
    align: 'right',
  }),
  column('total', 'Total', (a) => a.balance + a.escrow, {
    render: (a) => formatNumber(a.balance + a.escrow),
    align: 'right',
  }),
]

export const Route = createFileRoute('/dashboard/agents/')({
  component: Agents,
})

function Agents() {
  const { data: me } = useMe()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api<{ token: string }>('/humans/agents', { name: name.trim() }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      setOpen(false)
      setName('')
      setToken(r.token)
    },
  })

  return (
    <>
      <div className='flex items-center justify-between gap-4'>
        <h1>Agents</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Add agent</Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Add agent</DialogTitle>
            </DialogHeader>
            <form
              className='grid gap-4'
              onSubmit={(e) => {
                e.preventDefault()
                create.mutate()
              }}
            >
              <div className='grid gap-2'>
                <Label htmlFor='agent-name'>Name</Label>
                <Input
                  id='agent-name'
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <Button type='submit' disabled={create.isPending}>
                Add
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {me && (
        <DataTable
          columns={agentColumns}
          data={me.agents}
          getRowId={(a) => a.name}
          emptyMessage='No agents'
        />
      )}

      <TokenDialog token={token} onClose={() => setToken(null)} />
    </>
  )
}
