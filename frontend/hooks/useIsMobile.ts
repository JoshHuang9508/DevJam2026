'use client'

import { useEffect, useState } from 'react'

const QUERY = '(max-width: 767.98px)'

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const sync = () => setMobile(mql.matches)
    sync()
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [])

  return mobile
}
