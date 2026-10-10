import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, useMe } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Select value for the main account. Agent names can't contain '@'.
// Both selects ignore '': Radix reports it when the To list (filtered by
// From) changes under it.
export const ACCOUNT = '@account'

/**
 * Bank-style transfer between any two of your balances: pick From and To
 * (each listed with its balance), enter an amount against the From balance,
 * review, confirm. Passing `to` (an agent name) locks the destination.
 */
export function TransferDialog({
  to,
  children,
}: {
  to?: string
  children: React.ReactNode
}) {
  const { data: me } = useMe()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [src, setSrc] = useState(ACCOUNT)
  const [dst, setDst] = useState('')
  const [amount, setAmount] = useState('')

  const options = me
    ? [
        { value: ACCOUNT, label: 'Account', balance: me.balance },
        ...me.agents.map((a) => ({ value: a.name, label: a.name, balance: a.balance })),
      ]
    : []
  const find = (value: string) => options.find((o) => o.value === value)
  const firstOther = (value: string) => options.find((o) => o.value !== value)?.value ?? ''

  const reset = () => {
    setSrc(ACCOUNT)
    setDst(to ?? firstOther(ACCOUNT))
    setAmount('')
    setReviewing(false)
  }

  const transfer = useMutation({
    mutationFn: () =>
      api('/humans/transfer', {
        from_agent: src === ACCOUNT ? undefined : src,
        to_agent: dst === ACCOUNT ? undefined : dst,
        amount: Number(amount),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      setOpen(false)
      toast('Transferred')
    },
  })

  const source = find(src)
  const destination = find(dst)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset()
        setOpen(o)
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{reviewing ? 'Review transfer' : 'Transfer'}</DialogTitle>
        </DialogHeader>

        {reviewing ? (
          <>
            <dl className='grid grid-cols-[auto_1fr] gap-x-6 gap-y-2'>
              <dt className='text-muted-foreground'>From</dt>
              <dd>{source?.label}</dd>
              <dt className='text-muted-foreground'>To</dt>
              <dd>{destination?.label}</dd>
              <dt className='text-muted-foreground'>Amount</dt>
              <dd>{formatNumber(Number(amount))}</dd>
            </dl>
            <DialogFooter>
              <Button variant='outline' onClick={() => setReviewing(false)}>
                Back
              </Button>
              <Button disabled={transfer.isPending} onClick={() => transfer.mutate()}>
                Confirm transfer
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className='grid gap-4'
            onSubmit={(e) => {
              e.preventDefault()
              setReviewing(true)
            }}
          >
            <div className='grid gap-2'>
              <Label htmlFor='transfer-from'>From</Label>
              <Select
                value={src}
                onValueChange={(v) => {
                  if (!v) return
                  setSrc(v)
                  if (v === dst) setDst(firstOther(v))
                }}
              >
                <SelectTrigger id='transfer-from' className='w-full *:data-[slot=select-value]:flex-1'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options
                    .filter((o) => o.value !== to)
                    .map((o) => (
                      <SelectItem key={o.value} value={o.value} className='*:[span]:last:flex-1'>
                        <BalanceOption label={o.label} balance={o.balance} />
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='transfer-to'>To</Label>
              <Select value={dst} onValueChange={(v) => v && setDst(v)} disabled={!!to}>
                <SelectTrigger id='transfer-to' className='w-full *:data-[slot=select-value]:flex-1'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options
                    .filter((o) => o.value !== src)
                    .map((o) => (
                      <SelectItem key={o.value} value={o.value} className='*:[span]:last:flex-1'>
                        <BalanceOption label={o.label} balance={o.balance} />
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='transfer-amount'>Amount</Label>
              <Input
                id='transfer-amount'
                type='number'
                min={1}
                max={source?.balance}
                step={1}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className='text-sm text-muted-foreground'>
                {formatNumber(source?.balance ?? 0)} available
              </p>
            </div>
            <Button type='submit' disabled={!dst}>
              Review
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BalanceOption({ label, balance }: { label: string; balance: number }) {
  return (
    <span className='flex w-full justify-between gap-6'>
      <span>{label}</span>
      <span className='text-muted-foreground'>{formatNumber(balance)}</span>
    </span>
  )
}
