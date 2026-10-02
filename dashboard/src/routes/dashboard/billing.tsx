import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from '@/components/ui/8bit/toast'
import { type Payment, useMe, usePayments } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/8bit/button'
import { BuyDialog } from '@/components/buy-dialog'
import { PURCHASES_ENABLED } from '../../../../shared/pricing'
import { type Column, DataTable, column } from '@/components/data-table'

const paymentColumns: Column<Payment>[] = [
  column('date', 'Date', (p) => p.created_at, {
    render: (p) => new Date(p.created_at).toLocaleDateString(),
  }),
  column('amount', 'Amount', (p) => p.usd_cents, {
    render: (p) => `$${(p.usd_cents / 100).toFixed(2)}`,
    align: 'right',
  }),
  column('dabloons', 'Dabloons', (p) => p.dabloons, {
    render: (p) => formatNumber(p.dabloons),
    align: 'right',
  }),
]

export const Route = createFileRoute('/dashboard/billing')({
  validateSearch: (s: Record<string, unknown>): { checkout?: 'success' } =>
    s.checkout === 'success' ? { checkout: 'success' } : {},
  component: Billing,
})

function Billing() {
  const { checkout } = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { data: payments } = usePayments()
  const { data: me } = useMe()

  // Back from Stripe: the webhook may land a moment later, so refetch.
  useEffect(() => {
    if (checkout !== 'success') return
    toast('Payment complete')
    queryClient.invalidateQueries()
    navigate({ search: {}, replace: true })
  }, [checkout, navigate, queryClient])

  return (
    <>
      <div className='flex items-center justify-between gap-4'>
        <h1>Billing</h1>
        {PURCHASES_ENABLED && (
          <BuyDialog>
            <Button>Buy dabloons</Button>
          </BuyDialog>
        )}
      </div>

      {me && <p>Refundable: {formatNumber(me.refundable)}</p>}

      <section className='grid gap-4'>
        <h2>Purchases</h2>
        {payments && (
          <DataTable
            columns={paymentColumns}
            data={payments}
            getRowId={(p) => String(p.id)}
            emptyMessage='No purchases'
          />
        )}
      </section>
    </>
  )
}
