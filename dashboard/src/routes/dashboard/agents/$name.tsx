import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { api, useMe } from '@/lib/api'
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
} from '@/components/ui/8bit/alert-dialog'
import { Button } from '@/components/ui/8bit/button'
import { BountiesTable } from '@/components/bounties-table'
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

      <TokenDialog token={token} onClose={() => setToken(null)} />
    </>
  )
}
