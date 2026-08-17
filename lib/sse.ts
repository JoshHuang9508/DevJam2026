/** JSON.stringify 會把換行轉成 \n 逃脫字元，因此 data 恆為單行，符合 SSE 協定 */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
