import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { api, session } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldSeparator } from '@/components/ui/field'

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
        name: name.trim(),
      }),
  })

  return (
    <main className='mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6'>
      {approve.data ? (
        // The device picks up its token by polling, so the terminal carries on
        // by itself; the dashboard is the other way forward.
        <div className='grid gap-6 text-center'>
          <h1 className='text-4xl font-bold'>Device Linked</h1>
          <p className='text-muted-foreground'>Continue in your terminal</p>
          <FieldSeparator>or</FieldSeparator>
          <Button asChild>
            <Link to='/dashboard'>Go to dashboard</Link>
          </Button>
        </div>
      ) : (
        <>
          <h1>Link a device</h1>
          <form
            className='grid gap-4'
            onSubmit={(e) => {
              e.preventDefault()
              approve.mutate()
            }}
          >
            {search.code ? (
              // The link from `dabloons login` already carries the code: show it
              // for the person to check against their terminal, not as a field.
              <div className='grid gap-3 text-center'>
                <div className='flex items-center justify-center gap-1.5 font-mono text-2xl font-medium'>
                  {code.split('').map((c, i) =>
                    c === '-' ? (
                      <span key={i} className='px-1 text-muted-foreground'>
                        –
                      </span>
                    ) : (
                      <span key={i} className='flex h-12 w-9 items-center justify-center rounded-md border bg-muted'>
                        {c}
                      </span>
                    )
                  )}
                </div>
                <p className='text-sm text-muted-foreground'>Make sure this matches the code in your terminal.</p>
              </div>
            ) : (
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
            )}
            <div className='grid gap-2'>
              <Label htmlFor='device-name'>Name your first agent</Label>
              <Input
                id='device-name'
                required
                pattern='.*\S.*'
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
        </>
      )}
    </main>
  )
}
