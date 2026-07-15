import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Same helper as the web app: conditional classes + last-one-wins merging. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
