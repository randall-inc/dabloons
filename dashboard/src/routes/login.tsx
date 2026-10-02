import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { toast } from '@/components/ui/8bit/toast'
import { api, session } from '@/lib/api'
import { RESENT_MESSAGE, sendCode, verifyCode } from '@/lib/auth'
import { Button } from '@/components/ui/8bit/button'
import { Input } from '@/components/ui/8bit/input'
import { Label } from '@/components/ui/8bit/label'

// Referral links (?ref=CODE) can land on the home page, which stores the
// code under this key, or come straight here.
const REF_KEY = 'dabloons_ref'

// Where to go after signing in. Only same-site paths: never '//host' or
// '/\host', which browsers treat as another site.
function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : undefined
}

export const Route = createFileRoute('/login')({
  // ?password=1: password sign-in, which the Worker allows only for the one
  // app-directory reviewer account (reviewers can't get our emailed codes).
  validateSearch: (
    s: Record<string, unknown>
  ): { redirect?: string; ref?: string; password?: boolean } => ({
    redirect: safeRedirect(s.redirect),
    ref: typeof s.ref === 'string' ? s.ref : undefined,
    password: s.password ? true : undefined,
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
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function signedIn(token: string) {
    session.set(token)
    localStorage.removeItem(REF_KEY)
    navigate({ href: search.redirect ?? '/dashboard' })
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const ref = search.ref ?? localStorage.getItem(REF_KEY) ?? undefined
    if (search.password)
      return run(async () => {
        const x = await api<{ session_token: string }>('/auth/reviewer', {
          email: email.trim(),
          password,
          referral_code: ref,
        })
        signedIn(x.session_token)
      })
    if (!sent)
      return run(async () => {
        await sendCode(email.trim())
        setSent(true)
      })
    run(async () => {
      const result = await verifyCode(email.trim(), code.trim(), ref)
      if (typeof result !== 'string') {
        setCode('')
        toast(RESENT_MESSAGE)
        return
      }
      signedIn(result)
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
        {search.password && (
          <div className='grid gap-2'>
            <Label htmlFor='password'>Password</Label>
            <Input
              id='password'
              type='password'
              autoComplete='current-password'
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
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
          {sent || search.password ? 'Sign in' : 'Send code'}
        </Button>
      </form>
    </main>
  )
}
