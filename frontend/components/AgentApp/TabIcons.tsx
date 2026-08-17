interface IconProps {
  className?: string
}

/**
 * 行動版分頁列圖示。線條式、currentColor 上色，選取狀態靠父層改文字色即可。
 * aria-hidden：語意由按鈕自己的文字標籤提供，圖示重複唸一次只是噪音。
 */
function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  )
}

export function ChatIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20.5 11.5a7.5 7.5 0 0 1-10.9 6.7L4.5 19.5l1.3-5.1A7.5 7.5 0 1 1 20.5 11.5Z" />
      <path d="M9 11h6M9 14h3.5" />
    </Svg>
  )
}

export function MapIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8 9 4.5Z" />
      <path d="M9 4.5v12.7M15 6.8v12.7" />
    </Svg>
  )
}
