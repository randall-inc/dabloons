import { createFileRoute } from '@tanstack/react-router'
import { useBalanceHistory, useMe } from '@/lib/api'
import { formatWhole } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { BuyDialog } from '@/components/buy-dialog'
import { PURCHASES_ENABLED } from '../../../../shared/pricing'
import { TransferDialog } from '@/components/transfer-dialog'
import { type StatCardData, StatCards } from '@/components/stat-cards'

// A trend needs two days; until then the tile shows just the number.
function tile(label: string, values: number[]): StatCardData {
  return values.length > 1
    ? { label, series: values, format: formatWhole, deltaLabel: 'past 30 days' }
    : { label, value: values[0], format: formatWhole }
}

export const Route = createFileRoute('/dashboard/')({
  component: Overview,
})

function Overview() {
  const { data: me } = useMe()
  const { data: history } = useBalanceHistory()

  // Daily closes for the last 30 days, ending with the live balance. Snapshot
  // days are UTC, like the server's.
  const today = new Date().toISOString().slice(0, 10)
  const past = history?.filter((d) => d.day !== today) ?? []
  const agentsTotal = me ? me.agents.reduce((sum, a) => sum + a.balance, 0) : 0
  return (
    <>
      <div className='flex items-center justify-between gap-4'>
        <h1>Overview</h1>
        <div className='flex gap-2'>
          <TransferDialog>
            <Button>Transfer</Button>
          </TransferDialog>
          {PURCHASES_ENABLED && (
            <BuyDialog>
              <Button variant='outline'>Buy dabloons</Button>
            </BuyDialog>
          )}
        </div>
      </div>
      {/* Wait for history too: StatCards sizes its sparkline once, on mount. */}
      {me && history && (
        <StatCards
          columns={2}
          cards={[
            tile('Account', [...past.map((d) => d.account), me.balance]),
            tile('Agents', [...past.map((d) => d.agents), agentsTotal]),
          ]}
        />
      )}
    </>
  )
}
