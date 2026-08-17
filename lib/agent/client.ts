import 'server-only'
import { GoogleGenAI } from '@google/genai'

/** 2026-08 查證：Flash 系列最新穩定版。禁止改回 gemini-2.5-flash（2026-10-16 停用）。 */
export const DEFAULT_MODEL = 'gemini-3.7-flash'

let cached: GoogleGenAI | null = null

export function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY 未設定')
  if (!cached) cached = new GoogleGenAI({ apiKey })
  return cached
}

export function getModel(): string {
  return process.env.GEMINI_MODEL ?? DEFAULT_MODEL
}
