import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { api, session } from '@/lib/api'
import { Button } from '@/components/ui/8bit/button'
import { Input } from '@/components/ui/8bit/input'
import { Label } from '@/components/ui/8bit/label'

// `dabloons login` prints /device?code=XXXX-XXXX. Signing in first comes
// back here with the code intact.
export const Route = createFileRoute('/device')({
  validateSearch: (s: Record<string, unknown>): { code?: string } => ({
    code: typeof s.code === 'string' ? s.code : undefined,
  }),
  beforeLoad: ({ location }) => {
    if (!session.get()) throw redirect({ to: '/login', search: { redirect: location.href } })
  },
  component: Device,
})

function Device() {
  const search = Route.useSearch()
  const [code, setCode] = useState(search.code?.toUpperCase() ?? '')
  const [name, setName] = useState('')

  const approve = useMutation({
    mutationFn: () =>
      api<{ agent: { name: string } }>('/auth/device/approve', {
        user_code: code.trim().toUpperCase(),
        name: name.trim() || undefined,
      }),
  })

  return (
    <main className='mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6'>
      <h1>Link a device</h1>
      {approve.data ? (
        <>
          <p>
            Linked as <strong>{approve.data.agent.name}</strong>. Your device finishes
            signing in on its own.
          </p>
          <div>
            <Button asChild variant='outline'>
              <Link to='/dashboard'>Go to dashboard</Link>
            </Button>
          </div>
        </>
      ) : (
        <form
          className='grid gap-4'
          onSubmit={(e) => {
            e.preventDefault()
            approve.mutate()
          }}
        >
          <div className='grid gap-2'>
            <Label htmlFor='device-code'>Code</Label>
            <Input
              id='device-code'
              required
              autoComplete='off'
              spellCheck={false}
              maxLength={9}
              placeholder='XXXX-XXXX'
              className='font-mono uppercase'
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='device-name'>Agent name (optional)</Label>
            <Input
              id='device-name'
              autoComplete='off'
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type='submit' disabled={approve.isPending}>
            Approve
          </Button>
        </form>
      )}
    </main>
  )
}
