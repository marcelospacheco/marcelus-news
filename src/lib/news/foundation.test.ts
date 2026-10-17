import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "../../../scripts/migration-plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationsDir = join(root, "migrations");

const REQUIRED = [
  "sources",
  "articles",
  "article_analysis",
  "topics",
  "article_topics",
  "events",
  "event_articles",
  "ingestion_runs",
  "audit_logs",
];

async function migrate(pg: PGlite): Promise<string[]> {
  await pg.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const entries = await readdir(migrationsDir);
  const applied = (await pg.query<{ name: string }>("select name from _migrations")).rows.map((row) => row.name);
  const pending = pendingMigrations(entries, applied);
  for (const { name } of pending) {
    const sql = await readFile(join(migrationsDir, name), "utf8");
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into _migrations (name) values ($1)", [name]);
    });
  }
  return pending.map((item) => item.name);
}

describe("fase 1 — fundação", () => {
  it("aplica as migrações uma vez e cria o esquema", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    const first = await migrate(pg);
    assert.deepEqual(first, ["0001_auth.sql", "0002_news.sql", "0003_politics.sql"]);

    const second = await migrate(pg);
    assert.deepEqual(second, []);

    const tables = await pg.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const names = new Set(tables.rows.map((row) => row.table_name));
    for (const table of REQUIRED) assert.ok(names.has(table), `falta a tabela ${table}`);

    const tracked = await pg.query<{ name: string }>("select name from _migrations order by name");
    assert.deepEqual(
      tracked.rows.map((row) => row.name),
      ["0001_auth.sql", "0002_news.sql", "0003_politics.sql"],
    );
    await pg.close();
  });

  it("sobe com pelo menos cinco fontes RSS e não duplica o cadastro", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await migrate(pg);
    const sources = await pg.query<{ id: string; type: string; enabled: boolean }>(
      "select id, type, enabled from sources order by id",
    );
    const rss = sources.rows.filter((row) => row.type === "rss" && row.enabled);
    assert.ok(rss.length >= 5, `esperava 5 fontes RSS, veio ${rss.length}`);
    for (const id of ["g1", "bbc-brasil", "agencia-brasil", "cnn-brasil", "folha", "poder360", "camara", "senado"]) {
      assert.ok(sources.rows.some((row) => row.id === id && row.enabled), id);
    }
    assert.ok(sources.rows.some((row) => row.id === "tecnoblog" && row.enabled === false));
    const parked = sources.rows.filter((row) => row.type === "youtube" || row.type === "x");
    assert.equal(parked.length, 2);
    assert.ok(parked.every((row) => row.enabled === false));

    await migrate(pg);
    const again = await pg.query<{ n: number }>("select count(*)::int as n from sources");
    assert.equal(again.rows[0]?.n, sources.rows.length);
    await pg.close();
  });

  it("recusa a mesma notícia duas vezes e aceita a mesma história em outra fonte", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await migrate(pg);
    const insert = `insert into articles (
      id, source_id, external_id, url, canonical_url, title, content_hash, search_text
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)`;
    await pg.query(insert, [
      "a1",
      "g1",
      "ext-1",
      "https://g1.globo.com/exemplo",
      "https://g1.globo.com/exemplo",
      "Senado vota a PEC",
      "hash-1",
      "senado vota a pec",
    ]);
    await assert.rejects(
      () =>
        pg.query(insert, [
          "a2",
          "g1",
          "ext-1",
          "https://g1.globo.com/exemplo",
          "https://g1.globo.com/exemplo",
          "Senado vota a PEC",
          "hash-2",
          "senado vota a pec",
        ]),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );
    await pg.query(insert, [
      "a3",
      "folha",
      "ext-9",
      "https://www.folha.uol.com.br/exemplo",
      "https://www.folha.uol.com.br/exemplo",
      "Senado vota a PEC",
      "hash-1",
      "senado vota a pec",
    ]);
    const rows = await pg.query<{ n: number }>("select count(*)::int as n from articles");
    assert.equal(rows.rows[0]?.n, 2);
    await pg.close();
  });
});
