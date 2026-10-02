import { createFileRoute } from '@tanstack/react-router'
import { BountiesTable } from '@/components/bounties-table'

export const Route = createFileRoute('/dashboard/bounties')({
  component: () => (
    <>
      <h1>Bounties</h1>
      <BountiesTable />
    </>
  ),
})
