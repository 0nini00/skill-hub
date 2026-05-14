import { DatabaseSync } from "node:sqlite";
import { ensureBaseDirs, skillHubDbPath } from "./paths";

export function openDatabase(): DatabaseSync {
  ensureBaseDirs();
  const db = new DatabaseSync(skillHubDbPath);
  ensureDatabaseSchema(db);
  return db;
}

function ensureDatabaseSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      source TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_slug ON skills(slug);
    CREATE TABLE IF NOT EXISTS ignored_skills (
      slug TEXT PRIMARY KEY,
      ignored_at TEXT
    );
    CREATE TABLE IF NOT EXISTS hidden_skills (
      slug TEXT PRIMARY KEY,
      hidden_at TEXT
    );
  `);
  db.prepare(`
    INSERT OR IGNORE INTO hidden_skills (slug, hidden_at)
    SELECT slug, COALESCE(ignored_at, ?)
    FROM ignored_skills
  `).run(new Date().toISOString());
}
