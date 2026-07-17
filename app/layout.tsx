import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: 'Quatt Sales Support Tool',
  description: 'Quatt Sales Support Tool',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="nl">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Apply saved theme before paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('quatt_theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {/* Google Sign-In script — loaded async, accessed on the client */}
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="lazyOnload"
        />
        {children}
      </body>
    </html>
  )
}
