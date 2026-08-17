import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  await migrate();
  console.log("Database migration complete");
}

