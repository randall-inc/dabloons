import coin from '@/assets/coin.svg'
import { cn } from '@/lib/utils'

/** The coin plus DABLOONS in Geist Pixel. Sizes itself to the font size around it. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-[0.25em] font-pixel font-normal tracking-normal [-webkit-text-stroke:0.05em_currentColor]',
        className
      )}
    >
      <img src={coin} alt='' className='size-[0.9em] [image-rendering:pixelated]' />
      DABLOONS
    </span>
  )
}
