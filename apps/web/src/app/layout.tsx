import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers'
import { Toaster } from '@/components/ui/sonner'
import { BRAND_ACCENT } from '@jobsiteos/core'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'JobsiteOS',
    template: '%s · JobsiteOS',
  },
  description: 'Plataforma interna de operações da ONE OS.',
}

export const viewport: Viewport = {
  themeColor: BRAND_ACCENT,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning is required by next-themes: it writes the theme
    // class onto <html> before hydration, so server and client markup differ by
    // design on this one element.
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </Providers>
      </body>
    </html>
  )
}
