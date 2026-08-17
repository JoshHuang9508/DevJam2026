export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 串流進行中；完成後拿掉，UI 據此決定是否顯示游標 */
  streaming?: boolean
}
