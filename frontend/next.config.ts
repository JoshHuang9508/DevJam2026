import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],

  // dev server 透過 cloudflare tunnel 對外時，Next 16 會擋掉非預期 origin 的
  // /_next/* 請求並回 403 —— 症狀是 CSS 正常、JS 全部載不到、頁面完全不互動。
  // trycloudflare 每次啟動都換一組隨機子網域，所以用萬用字元。
  allowedDevOrigins: ['*.trycloudflare.com'],
}

export default nextConfig
