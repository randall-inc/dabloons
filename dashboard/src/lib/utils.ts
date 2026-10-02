import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const formatNumber = (n: number) => n.toLocaleString()

// Stat tiles tween between values, so round what's on screen.
export const formatWhole = (n: number) => formatNumber(Math.round(n))
