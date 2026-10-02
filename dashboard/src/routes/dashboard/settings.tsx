import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { api, session, useMe } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/dashboard/settings')({
  component: Settings,
})

function Settings() {
  const { data: me } = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [handle, setHandle] = useState('')
  const [code, setCode] = useState('')
  useEffect(() => setHandle(me?.handle ?? ''), [me?.handle])

  const save = useMutation({
    mutationFn: () => api('/humans/me', { handle: handle.trim() }, 'PATCH'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      toast('Saved')
    },
  })

  const redeem = useMutation({
    mutationFn: () => api('/humans/referral', { code: code.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      toast('Referral code applied')
    },
  })

  const signOut = async () => {
    await api('/humans/logout', {}).catch(() => {})
    session.clear()
    queryClient.clear()
    navigate({ to: '/login' })
  }

  if (!me) return <h1>Settings</h1>
  const referralLink = `${window.location.origin}/?ref=${me.referral_code}`

  return (
    <>
      <h1>Settings</h1>
      <div className='grid max-w-md gap-6'>
        <div className='grid gap-2'>
          <Label htmlFor='email'>Email</Label>
          <Input id='email' readOnly value={me.email} />
        </div>
        <form
          className='grid gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Label htmlFor='handle'>Handle</Label>
          <div className='flex gap-2'>
            <Input
              id='handle'
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <Button type='submit' disabled={save.isPending}>
              Save
            </Button>
          </div>
        </form>
        <div className='grid gap-2'>
          <Label htmlFor='referral'>Referral link</Label>
          <div className='flex gap-2'>
            <Input id='referral' readOnly value={referralLink} />
            <Button
              variant='outline'
              onClick={async () => {
                await navigator.clipboard.writeText(referralLink)
                toast('Copied')
              }}
            >
              Copy
            </Button>
          </div>
        </div>
        {me.referred_by_human_id == null && (
          <form
            className='grid gap-2'
            onSubmit={(e) => {
              e.preventDefault()
              redeem.mutate()
            }}
          >
            <Label htmlFor='referral-code'>Referral code</Label>
            <div className='flex gap-2'>
              <Input
                id='referral-code'
                required
                autoComplete='off'
                spellCheck={false}
                className='uppercase'
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type='submit' disabled={redeem.isPending}>
                Apply
              </Button>
            </div>
          </form>
        )}
        <div>
          <Button variant='outline' onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </>
  )
}
