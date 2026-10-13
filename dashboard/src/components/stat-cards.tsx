import { Area, AreaChart } from 'recharts'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer } from '@/components/ui/chart'

export type StatCardData = {
  label: string
  /** Daily values, oldest first; the last one is the headline. */
  series?: number[]
  value?: number
  format?: (value: number) => string
  deltaLabel?: string
}

const chartConfig = { v: { label: 'Value', color: 'var(--primary)' } } satisfies ChartConfig

function StatCard({ label, series, value, format = String, deltaLabel }: StatCardData) {
  const headline = value ?? series?.at(-1) ?? 0
  const first = series?.[0]
  const trend = series && series.length > 1
  // Only a tile with a deltaLabel shows the change since its first day.
  const delta = trend && deltaLabel && first ? ((headline - first) / first) * 100 : null
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className='text-xl tabular-nums'>{format(headline)}</CardTitle>
      </CardHeader>
      {trend && (
        <CardContent className='grid gap-3'>
          {delta != null && (
            <p className={cn('text-xs', delta >= 0 ? 'text-green-600' : 'text-destructive')}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% {deltaLabel}
            </p>
          )}
          <ChartContainer config={chartConfig} className='aspect-auto h-16 w-full'>
            <AreaChart data={series!.map((v) => ({ v }))} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
              <Area
                dataKey='v'
                type='step'
                fill='var(--color-v)'
                fillOpacity={0.3}
                stroke='var(--color-v)'
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      )}
    </Card>
  )
}

export function StatCards({ cards, columns }: { cards: StatCardData[]; columns: 2 | 3 | 4 }) {
  return (
    <div className={cn(
        'grid gap-6',
        { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns]
      )}>
      {cards.map((card) => (
        <StatCard key={card.label} {...card} />
      ))}
    </div>
  )
}
