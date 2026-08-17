import pg from "pg";
import { searchSessionSchema, type ConversationMessage, type RankingSnapshot, type SearchSession } from "../domain/sessions/schema.js";

export interface SessionRepository {
  create(session: SearchSession): Promise<SearchSession>;
  get(id: string): Promise<SearchSession | null>;
  save(session: SearchSession): Promise<SearchSession>;
  close(): Promise<void>;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SearchSession>();
  async create(session: SearchSession): Promise<SearchSession> { this.sessions.set(session.id, structuredClone(session)); return structuredClone(session); }
  async get(id: string): Promise<SearchSession | null> { const value = this.sessions.get(id); return value ? structuredClone(value) : null; }
  async save(session: SearchSession): Promise<SearchSession> { this.sessions.set(session.id, structuredClone(session)); return structuredClone(session); }
  async close(): Promise<void> {}
}

export class PostgresSessionRepository implements SessionRepository {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) { this.pool = new pg.Pool({ connectionString }); }

  async create(session: SearchSession): Promise<SearchSession> {
    await this.pool.query(
      `INSERT INTO search_sessions (id, user_id, preferences, candidates, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.id, session.userId, JSON.stringify(session.preferences), JSON.stringify(session.candidates), session.createdAt, session.updatedAt],
    );
    return session;
  }

  async get(id: string): Promise<SearchSession | null> {
    const [sessionResult, messagesResult, rankingsResult] = await Promise.all([
      this.pool.query("SELECT * FROM search_sessions WHERE id = $1", [id]),
      this.pool.query("SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at, id", [id]),
      this.pool.query("SELECT * FROM ranking_snapshots WHERE session_id = $1 ORDER BY created_at, id", [id]),
    ]);
    const row = sessionResult.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return searchSessionSchema.parse({
      id: row.id,
      userId: row.user_id,
      preferences: row.preferences,
      candidates: row.candidates,
      conversation: messagesResult.rows.map(mapMessage),
      rankingHistory: rankingsResult.rows.map(mapRanking),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    });
  }

  async save(session: SearchSession): Promise<SearchSession> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE search_sessions SET user_id = $2, preferences = $3, candidates = $4, updated_at = $5 WHERE id = $1",
        [session.id, session.userId, JSON.stringify(session.preferences), JSON.stringify(session.candidates), session.updatedAt],
      );
      await client.query("DELETE FROM conversation_messages WHERE session_id = $1", [session.id]);
      for (const message of session.conversation) {
        await client.query(
          "INSERT INTO conversation_messages (id, session_id, turn_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
          [message.id, session.id, message.turnId, message.role, message.content, message.createdAt],
        );
      }
      await client.query("DELETE FROM ranking_snapshots WHERE session_id = $1", [session.id]);
      for (const ranking of session.rankingHistory) {
        await client.query(
          "INSERT INTO ranking_snapshots (id, session_id, preference_version, candidates, created_at) VALUES ($1, $2, $3, $4, $5)",
          [ranking.id, session.id, ranking.preferenceVersion, JSON.stringify(ranking.candidates), ranking.createdAt],
        );
      }
      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> { await this.pool.end(); }
}

function mapMessage(row: Record<string, unknown>): ConversationMessage {
  return { id: String(row.id), turnId: String(row.turn_id), role: row.role as "user" | "assistant", content: String(row.content), createdAt: toIso(row.created_at) };
}
function mapRanking(row: Record<string, unknown>): RankingSnapshot {
  return { id: String(row.id), preferenceVersion: Number(row.preference_version), candidates: row.candidates as RankingSnapshot["candidates"], createdAt: toIso(row.created_at) };
}
function toIso(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }

