import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

/** The Dabloons wordmark: Geist Mono, uppercase. Links home by default. */
export function Logo({ className, to = '/' }: { className?: string; to?: '/' | '/dashboard' }) {
  return (
    <Link to={to} className={cn('font-heading text-xl leading-none font-semibold uppercase', className)}>
      Dabloons
    </Link>
  )
}
