import { AgentApp } from '@/components/AgentApp/AgentApp'

/**
 * 主畫面：對話（後端 Pi agent 選行政區）＋ 權重面板 ＋ 地圖 ＋ 物件卡片。
 * 只用 lib/scoring 排序、不接對話的原版保留在 /classic。
 */
export default function Home() {
  return <AgentApp />
}
