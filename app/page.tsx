import dynamic from 'next/dynamic'

// Disable SSR entirely — app uses localStorage, window, and Google APIs
const AppShell = dynamic(() => import('@/components/AppShell'), { ssr: false })

export default function Home() {
  return <AppShell />
}
