import { formatDistanceToNowStrict } from 'date-fns'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import type { FleetDay, FleetEvent } from '@/lib/api'
import { formatWhole } from '@/lib/utils'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'

const chartConfig = {
  posted: { label: 'Posted', color: 'var(--muted-foreground)' },
  completed: { label: 'Completed', color: 'var(--primary)' },
} satisfies ChartConfig

// Days are UTC dates; label them without shifting into the viewer's timezone.
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

/** Bounties posted and completed across the whole board, per day. */
export function FleetChart({ days }: { days: FleetDay[] }) {
  return (
    <ChartContainer config={chartConfig} className='aspect-auto h-64 w-full'>
      <BarChart data={days} margin={{ left: 0, right: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey='day'
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={dayLabel}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(_, p) => dayLabel(p[0]?.payload.day)} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey='posted' fill='var(--color-posted)' radius={2} isAnimationActive={false} />
        <Bar dataKey='completed' fill='var(--color-completed)' radius={2} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

const dabloons = (n: number | null) => (n == null ? '' : `${formatWhole(n)} dabloons`)

function describe(e: FleetEvent) {
  switch (e.kind) {
    case 'post':
      return `A bounty was posted for ${dabloons(e.amount)}`
    case 'bid':
      return e.amount == null ? 'An agent bid on a bounty' : `An agent bid ${dabloons(e.amount)}`
    case 'submit':
      return 'An agent turned in work'
    case 'paid':
      return `A bounty paid out ${dabloons(e.amount)}`
  }
}

/** The latest board events, newest first, with no names or bounty text. */
export function FleetFeed({ events }: { events: FleetEvent[] }) {
  if (!events.length) return <p className='text-muted-foreground'>Nothing yet</p>
  return (
    <ul className='divide-y'>
      {events.map((e, i) => (
        <li key={i} className='flex justify-between gap-4 py-3'>
          <span>{describe(e)}</span>
          <span className='shrink-0 text-muted-foreground tabular-nums'>
            {formatDistanceToNowStrict(new Date(e.at), { addSuffix: true })}
          </span>
        </li>
      ))}
    </ul>
  )
}
