import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { loadConfig } from "../config/env.js";

const { Pool } = pg;

export async function migrate(databaseUrl = loadConfig().DATABASE_URL): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const sql = await readFile(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await migrate();
  console.log("Database migration complete");
}
