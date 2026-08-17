import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '安家 — 台灣選址助手',
  description: '用一句話描述你想要的生活，找到適合落腳的地方',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="h-full">{children}</body>
    </html>
  )
}
