import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { api, session } from '@/lib/api'
import { RiGithubFill } from '@remixicon/react'
import {
  RESENT_MESSAGE,
  SOCIAL_VERIFIER_PARAM,
  type SocialProvider,
  finishSocial,
  reviewerEmail,
  sendCode,
  startSocial,
  verifyCode,
} from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import loginDay from '@/assets/login-halloween-light-dither.png'
import loginDayAnimated from '@/assets/login-halloween-light-dither.webp'
import loginNight from '@/assets/login-halloween-dark-dither.png'
import loginNightAnimated from '@/assets/login-halloween-dark-dither.webp'
import { Wordmark } from '@/components/wordmark'

// Referral links (?ref=CODE) can land on the home page, which stores the
// code under this key, or come straight here.
const REF_KEY = 'dabloons_ref'

// Where to go after signing in. Only same-site paths: never '//host' or
// '/\host', which browsers treat as another site.
function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : undefined
}

export const Route = createFileRoute('/login')({
  // ?password=1, or entering the reviewer email: password sign-in, which the
  // Worker allows only for the one app-directory reviewer account (reviewers
  // can't get our emailed codes).
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
  const [adult, setAdult] = useState(false)
  const [reviewer, setReviewer] = useState(false)
  const usePassword = search.password || reviewer
  // Arriving from `dabloons login`'s link: show its code so the person can
  // check it matches the one in their terminal before signing in.
  const deviceCode = search.redirect?.startsWith('/device')
    ? new URL(search.redirect, window.location.origin).searchParams.get('code')?.toUpperCase()
    : undefined
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

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

  function signedIn(token: string, to = search.redirect) {
    session.set(token)
    localStorage.removeItem(REF_KEY)
    navigate({ href: to ?? '/dashboard' })
  }

  // Back from GitHub/Google: redeem Neon's verifier (once, even under
  // StrictMode's double effects), or show the error Neon sent back.
  const returned = useRef(false)
  useEffect(() => {
    if (returned.current) return
    returned.current = true
    const params = new URLSearchParams(window.location.search)
    const verifier = params.get(SOCIAL_VERIFIER_PARAM)
    if (verifier)
      run(async () => {
        const r = await finishSocial(verifier)
        signedIn(r.token, r.redirect)
      })
    else if (params.get('error')) toast("Couldn't sign in. Try again.")
  }, [])

  const social = (provider: SocialProvider) => {
    if (!adult) return toast('Confirm you are 18 or older first.')
    run(() =>
      startSocial(provider, {
        redirect: search.redirect,
        ref: search.ref ?? localStorage.getItem(REF_KEY) ?? undefined,
        ageConfirmed: adult,
      })
    )
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const ref = search.ref ?? localStorage.getItem(REF_KEY) ?? undefined
    if (usePassword)
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
        if (email.trim().toLowerCase() === (await reviewerEmail())) return setReviewer(true)
        await sendCode(email.trim())
        setSent(true)
      })
    run(async () => {
      const result = await verifyCode(email.trim(), code.trim(), ref, adult)
      if (typeof result !== 'string') {
        setCode('')
        toast(RESENT_MESSAGE)
        return
      }
      signedIn(result)
    })
  }

  // Layout from shadcn's signup-02 block: form on the left, cover art on the right.
  return (
    <main className='grid min-h-svh lg:grid-cols-2'>
      <div className='flex flex-col gap-4 p-6 md:p-10'>
        <div className='flex justify-center md:justify-start'>
          <Link to='/' aria-label='Dabloons home' className='text-2xl'>
            <Wordmark />
          </Link>
        </div>
        <div className='flex flex-1 items-center justify-center'>
          <form ref={formRef} onSubmit={onSubmit} className='w-full max-w-xs'>
            <FieldGroup>
              <h1 className='text-center text-2xl font-bold text-balance'>
                {sent ? 'Enter the code from your Email' : 'Sign in or create account'}
              </h1>
              {deviceCode && (
                <p className='text-center text-sm text-muted-foreground'>
                  Linking the agent showing code{' '}
                  <span className='font-mono font-medium text-foreground'>{deviceCode}</span>
                </p>
              )}
              <Field>
                <FieldLabel htmlFor='email'>Email</FieldLabel>
                <Input
                  id='email'
                  type='email'
                  autoComplete='email'
                  required
                  disabled={sent || reviewer}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {usePassword && (
                <Field>
                  <FieldLabel htmlFor='password'>Password</FieldLabel>
                  <Input
                    id='password'
                    type='password'
                    autoComplete='current-password'
                    required
                    autoFocus={reviewer}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              )}
              {sent && (
                <Field>
                  <FieldLabel htmlFor='code'>Code</FieldLabel>
                  {/* Neon emails a 6-digit code; a full code submits on its own. */}
                  <InputOTP
                    id='code'
                    maxLength={6}
                    pattern={REGEXP_ONLY_DIGITS}
                    required
                    autoFocus
                    value={code}
                    onChange={setCode}
                    onComplete={() => formRef.current?.requestSubmit()}
                    containerClassName='justify-center'
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }, (_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </Field>
              )}
              {!sent && !usePassword && (
                <Field orientation='horizontal'>
                  <Checkbox id='adult' checked={adult} onCheckedChange={(v) => setAdult(v === true)} required />
                  <FieldLabel htmlFor='adult' className='block leading-snug font-normal'>
                    I am 18 or older and agree to the <a href='/terms' className='underline'>Terms</a> and <a href='/privacy' className='underline'>Privacy Policy</a>.
                  </FieldLabel>
                </Field>
              )}
              <Field>
                <Button type='submit' disabled={busy}>
                  {sent || usePassword ? 'Sign in' : 'Send code'}
                </Button>
              </Field>
              {!sent && !usePassword && (
                <>
                  <FieldSeparator>Or continue with</FieldSeparator>
                  <Field>
                    <Button variant='outline' type='button' disabled={busy} onClick={() => social('github')}>
                      <RiGithubFill />
                      GitHub
                    </Button>
                  </Field>
                </>
              )}
            </FieldGroup>
          </form>
        </div>
      </div>
      <div className='relative hidden bg-muted lg:block'>
        {/* Halloween art: a pumpkin shore in light mode, a haunted lighthouse in dark
            mode. Animated WebPs loop on their own; reduced-motion visitors get the still frame. */}
        <picture className='dark:hidden'>
          <source srcSet={loginDay} media='(prefers-reduced-motion: reduce)' />
          <img
            src={loginDayAnimated}
            alt=''
            className='absolute inset-0 size-full object-cover [image-rendering:pixelated]'
          />
        </picture>
        <picture className='hidden dark:block'>
          <source srcSet={loginNight} media='(prefers-reduced-motion: reduce)' />
          <img
            src={loginNightAnimated}
            alt=''
            className='absolute inset-0 size-full object-cover [image-rendering:pixelated]'
          />
        </picture>
      </div>
    </main>
  )
}
