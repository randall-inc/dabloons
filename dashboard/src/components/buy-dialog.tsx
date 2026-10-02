import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  MAX_USD_CENTS,
  MIN_USD_CENTS,
  bonusPercent,
  dabloonsFor,
} from '../../../shared/pricing'

// One bundle per bonus tier: none, +5%, +10%.
const PRESETS = [10, 50, 100]

/**
 * Pick a bundle (or a custom dollar amount), then continue to Stripe's hosted
 * checkout. Stripe returns to /dashboard/billing?checkout=success.
 */
export function BuyDialog({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState(String(PRESETS[1]))
  const [custom, setCustom] = useState('')
  const usd = choice === 'custom' ? Number(custom) : Number(choice)
  const cents = usd * 100
  const valid = Number.isInteger(usd) && cents >= MIN_USD_CENTS && cents <= MAX_USD_CENTS

  const checkout = useMutation({
    mutationFn: () => api<{ url: string }>('/checkout', { usd_cents: cents }),
    onSuccess: (r) => window.location.assign(r.url),
  })

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setChoice(String(PRESETS[1]))
          setCustom('')
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Buy dabloons</DialogTitle>
        </DialogHeader>
        <form
          className='grid gap-4'
          onSubmit={(e) => {
            e.preventDefault()
            checkout.mutate()
          }}
        >
          <RadioGroup value={choice} onValueChange={setChoice} className='gap-2'>
            {PRESETS.map((p) => (
              <Option key={p} value={String(p)}>
                <span className='flex-1'>
                  {formatNumber(dabloonsFor(p * 100))} dabloons
                  {bonusPercent(p * 100) > 0 && (
                    <span className='ms-2 text-muted-foreground'>
                      +{bonusPercent(p * 100)}%
                    </span>
                  )}
                </span>
                <span>${p}</span>
              </Option>
            ))}
            <Option value='custom'>
              <span>Custom amount</span>
            </Option>
          </RadioGroup>

          {choice === 'custom' && (
            <div className='grid gap-2'>
              <Label htmlFor='custom-usd'>Amount (USD)</Label>
              <Input
                id='custom-usd'
                type='number'
                min={MIN_USD_CENTS / 100}
                max={MAX_USD_CENTS / 100}
                step={1}
                required
                autoFocus
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
          )}

          <Button type='submit' disabled={!valid || checkout.isPending}>
            {valid
              ? `Buy ${formatNumber(dabloonsFor(cents))} dabloons for $${usd}`
              : 'Buy dabloons'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Option({ value, children }: { value: string; children: React.ReactNode }) {
  const id = `buy-${value}`
  return (
    <Label
      htmlFor={id}
      className='flex cursor-pointer items-center gap-3 rounded-md border p-4 font-normal has-data-[state=checked]:border-primary'
    >
      <RadioGroupItem id={id} value={value} />
      {children}
    </Label>
  )
}
