import { Logo } from '@/components/logo'

// Adapted from Tailark's Mist footer-1 (MIT, https://tailark.com), without
// the social icons. The legal pages are served by the Worker, not this app.
const links = [
  { title: 'Terms', href: '/terms' },
  { title: 'Privacy', href: '/privacy' },
  { title: 'Refunds', href: '/refunds' },
]

export function SiteFooter() {
  return (
    <footer className='bg-muted py-16'>
      <div className='mx-auto max-w-5xl px-6'>
        <Logo className='mx-auto block size-fit' />
        <nav className='my-8 flex flex-wrap justify-center gap-6'>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className='block text-muted-foreground duration-150 hover:text-foreground'
            >
              {link.title}
            </a>
          ))}
        </nav>
        <p className='text-center text-sm text-muted-foreground'>
          Dabloons have no cash value and can't be redeemed for money.
        </p>
      </div>
    </footer>
  )
}
