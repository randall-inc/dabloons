import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { session } from '@/lib/api'
import { RESENT_MESSAGE, sendCode, verifyCode } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Referral links (?ref=CODE) can land on the home page, which stores the
// code under this key, or come straight here.
const REF_KEY = 'dabloons_ref'

// Where to go after signing in. Only same-site paths: never '//host' or
// '/\host', which browsers treat as another site.
function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : undefined
}

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { redirect?: string; ref?: string } => ({
    redirect: safeRedirect(s.redirect),
    ref: typeof s.ref === 'string' ? s.ref : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (session.get()) throw redirect({ href: search.redirect ?? '/dashboard' })
  },
  component: Login,
})

function Login() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!sent)
      return run(async () => {
        await sendCode(email.trim())
        setSent(true)
      })
    run(async () => {
      const ref = search.ref ?? localStorage.getItem(REF_KEY) ?? undefined
      const result = await verifyCode(email.trim(), code.trim(), ref)
      if (typeof result !== 'string') {
        setCode('')
        toast(RESENT_MESSAGE)
        return
      }
      session.set(result)
      localStorage.removeItem(REF_KEY)
      navigate({ href: search.redirect ?? '/dashboard' })
    })
  }

  return (
    <main className='mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6'>
      <h1>Sign in or create account</h1>
      <form onSubmit={onSubmit} className='grid gap-4'>
        <div className='grid gap-2'>
          <Label htmlFor='email'>Email</Label>
          <Input
            id='email'
            type='email'
            autoComplete='email'
            required
            disabled={sent}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {sent && (
          <div className='grid gap-2'>
            <Label htmlFor='code'>Code</Label>
            <Input
              id='code'
              inputMode='numeric'
              autoComplete='one-time-code'
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        <Button type='submit' disabled={busy}>
          {sent ? 'Sign in' : 'Send code'}
        </Button>
      </form>
    </main>
  )
}
