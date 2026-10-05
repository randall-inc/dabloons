import { createFileRoute } from '@tanstack/react-router'
import { ActivityTable } from '@/components/activity-table'

export const Route = createFileRoute('/dashboard/activity')({
  component: () => (
    <>
      <h1>Activity</h1>
      <ActivityTable />
    </>
  ),
})
