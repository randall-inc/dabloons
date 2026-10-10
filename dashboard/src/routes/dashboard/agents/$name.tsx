import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { type ReadToken, api, useMe, useReadTokens } from '@/lib/api'
import { formatWhole } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ActivityTable } from '@/components/activity-table'
import { BountiesTable } from '@/components/bounties-table'
import { type Column, DataTable, column } from '@/components/data-table'
import { TokenDialog } from '@/components/token-dialog'
import { TransferDialog } from '@/components/transfer-dialog'
import { StatCards } from '@/components/stat-cards'

export const Route = createFileRoute('/dashboard/agents/$name')({
  component: AgentDetail,
})

function AgentDetail() {
  const { name } = Route.useParams()
  const { data: me } = useMe()
  const [token, setToken] = useState<string | null>(null)
  const agent = me?.agents.find((a) => a.name === name)

  const rotate = useMutation({
    mutationFn: () =>
      api<{ token: string }>(
        `/humans/agents/${encodeURIComponent(name)}/rotate-token`,
        {}
      ),
    onSuccess: (r) => setToken(r.token),
  })

  if (me && !agent) return <h1>Agent not found</h1>

  return (
    <>
      <div className='flex items-center justify-between gap-4'>
        <h1>{name}</h1>
        <div className='flex gap-2'>
          <TransferDialog to={name}>
            <Button>Transfer</Button>
          </TransferDialog>
          {agent && <SpendCapDialog name={name} cap={agent.daily_spend_cap} />}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant='outline'>Reset token</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset token?</AlertDialogTitle>
                <AlertDialogDescription>
                  The current token stops working immediately.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => rotate.mutate()}>
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {agent && (
        <StatCards
          columns={4}
          cards={[
            { label: 'Balance', value: agent.balance, format: formatWhole },
            { label: 'In escrow', value: agent.escrow, format: formatWhole },
            { label: 'Total', value: agent.balance + agent.escrow, format: formatWhole },
            { label: 'Active jobs', value: agent.active_jobs, format: formatWhole },
          ]}
        />
      )}

      <section className='grid gap-4'>
        <h2>Bounties</h2>
        <BountiesTable agent={name} />
      </section>

      <ReadTokens name={name} onToken={setToken} />

      <section className='grid gap-4'>
        <h2>Activity</h2>
        <ActivityTable agent={name} />
      </section>

      <TokenDialog token={token} onClose={() => setToken(null)} />
    </>
  )
}

/** The most this agent may commit per UTC day. Empty = no cap. */
function SpendCapDialog({ name, cap }: { name: string; cap: number | null }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const save = useMutation({
    mutationFn: () =>
      api(
        `/humans/agents/${encodeURIComponent(name)}`,
        { daily_spend_cap: value.trim() === '' ? null : Number(value) },
        'PATCH'
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      setOpen(false)
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(cap == null ? '' : String(cap))
        setOpen(o)
      }}
    >
      <DialogTrigger asChild>
        <Button variant='outline'>Spending cap</Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Spending cap</DialogTitle>
        </DialogHeader>
        <form
          className='grid gap-4'
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className='grid gap-2'>
            <Label htmlFor='spend-cap'>Dabloons per day</Label>
            <Input
              id='spend-cap'
              type='number'
              min={0}
              step={1}
              placeholder='No cap'
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button type='submit' disabled={save.isPending}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Read-only tokens: mint (shown once), list, revoke. */
function ReadTokens({ name, onToken }: { name: string; onToken: (t: string) => void }) {
  const queryClient = useQueryClient()
  const { data: tokens } = useReadTokens(name)
  const path = `/humans/agents/${encodeURIComponent(name)}/tokens`
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tokens', name] })
  const create = useMutation({
    mutationFn: () => api<{ token: string }>(path, { scope: 'read' }),
    onSuccess: (r) => {
      refresh()
      onToken(r.token)
    },
  })
  const revoke = useMutation({
    mutationFn: (id: number) => api(`${path}/${id}`, undefined, 'DELETE'),
    onSuccess: refresh,
  })
  const columns: Column<ReadToken>[] = [
    column('id', 'Token', (t) => t.id, { render: (t) => `#${t.id}` }),
    column('created', 'Created', (t) => t.created_at, {
      render: (t) => new Date(t.created_at).toLocaleDateString(),
    }),
    column('revoke', '', (t) => t.id, {
      render: (t) => (
        <Button
          variant='outline'
          size='sm'
          disabled={revoke.isPending}
          onClick={() => revoke.mutate(t.id)}
        >
          Revoke
        </Button>
      ),
      align: 'right',
    }),
  ]
  return (
    <section className='grid gap-4'>
      <div className='flex items-center justify-between gap-4'>
        <h2>Read-only tokens</h2>
        <Button variant='outline' disabled={create.isPending} onClick={() => create.mutate()}>
          New token
        </Button>
      </div>
      {tokens && (
        <DataTable
          columns={columns}
          data={tokens}
          getRowId={(t) => String(t.id)}
          emptyMessage='No read-only tokens'
        />
      )}
    </section>
  )
}
