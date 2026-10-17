import { getSql } from "@/lib/db";
import { publish } from "./bus";
import { parseFeed } from "./rss";
import {
  clip,
  CLUSTER_THRESHOLD,
  contentHash,
  coversPolitics,
  fold,
  storySimilarity,
} from "./text";
import type { IngestReport } from "./types";
import { assertPublicHttpUrl, canonicalUrl, safeImageUrl } from "./url";

type SourceRow = {
  id: string;
  name: string;
  type: string;
  feed_url: string | null;
  enabled: boolean;
  poll_interval_seconds: number;
  config: unknown;
};

type RecentArticle = {
  id: string;
  title: string;
  canonical_url: string;
  source_id: string;
  published_at: Date | string | null;
  discovered_at: Date | string;
  event_id: string | null;
};

const USER_AGENT = "MarcelusNews/1.0 (agregador de politica e eleicoes; credito e link da fonte)";
const WINDOW_MS = 36 * 60 * 60 * 1000;

let current: Promise<IngestReport> | null = null;
let schedulerStarted = false;

const globalRef = globalThis as typeof globalThis & { __pulsoScheduler?: boolean };

export function ensureIngest(force = false): Promise<IngestReport> {
  ensureScheduler();
  if (current && !force) return current;
  if (current && force) {
    const running = current;
    return running.then(() => (current ? current : ensureIngest(true)));
  }
  current = runIngest(force).finally(() => {
    current = null;
  });
  return current;
}

function ensureScheduler(): void {
  if (schedulerStarted || globalRef.__pulsoScheduler) return;
  schedulerStarted = true;
  globalRef.__pulsoScheduler = true;
  const timer = setInterval(() => {
    void ensureIngest(false).catch((error: unknown) => {
      log("ingest.scheduler_error", { message: messageOf(error) });
    });
  }, 60_000);
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
}

async function runIngest(force: boolean): Promise<IngestReport> {
  const remote = await collectFromService(force);
  if (remote) return remote;
  return runIngestLocal(force);
}

async function collectFromService(force: boolean): Promise<IngestReport | null> {
  // The sidecar writes the dev database. A production preview has its own
  // database, so it collects locally unless it shares DATABASE_URL.
  const sharesDatabase = Boolean(process.env.DATABASE_URL) || process.env.COLLECTOR_WAIT === "1";
  if (!sharesDatabase) return null;
  const base = process.env.COLLECTOR_URL ?? "http://127.0.0.1:8091";
  const waitMs = process.env.COLLECTOR_WAIT === "1" ? 8_000 : 0;
  if (!(await collectorReady(base, waitMs))) return null;
  try {
    const response = await fetch(`${base}/v1/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ force }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<IngestReport> & { busy?: boolean };
    if (data.busy) {
      return { ran: false, sourcesChecked: 0, itemsFound: 0, itemsNew: 0, itemsDuplicate: 0, errors: 0 };
    }
    if (typeof data.sourcesChecked !== "number") return null;
    log("ingest.python", {
      sources: data.sourcesChecked,
      created: data.itemsNew ?? 0,
      duplicate: data.itemsDuplicate ?? 0,
      errors: data.errors ?? 0,
    });
    return {
      ran: Boolean(data.ran),
      sourcesChecked: data.sourcesChecked,
      itemsFound: Number(data.itemsFound ?? 0),
      itemsNew: Number(data.itemsNew ?? 0),
      itemsDuplicate: Number(data.itemsDuplicate ?? 0),
      errors: Number(data.errors ?? 0),
    };
  } catch (error) {
    log("ingest.python_unavailable", { message: messageOf(error) });
    return null;
  }
}

async function collectorReady(base: string, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  do {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return true;
    } catch (error) {
      if (waitMs === 0) {
        log("ingest.python_unavailable", { message: messageOf(error) });
        return false;
      }
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() <= deadline);
  return false;
}

async function runIngestLocal(force: boolean): Promise<IngestReport> {
  const sql = await getSql();
  const sources = await sql.query<SourceRow>(
    `select id, name, type, feed_url, enabled, poll_interval_seconds, config
     from sources
     where enabled = true
       and ($1::boolean = true or (
         (next_poll_at is null or next_poll_at <= now())
         and (last_attempt_at is null or last_attempt_at <= now() - (poll_interval_seconds * interval '1 second'))
       ))
     order by id`,
    [force],
  );
  if (!sources.length) {
    return { ran: false, sourcesChecked: 0, itemsFound: 0, itemsNew: 0, itemsDuplicate: 0, errors: 0 };
  }

  const fetched = await mapPool(sources, 4, async (source) => {
    const started = Date.now();
    try {
      await sql.query(`update sources set last_attempt_at = now(), updated_at = now() where id = $1`, [source.id]);
      if (source.type !== "rss" && source.type !== "atom") {
        throw new Error("Conector sem credencial oficial. Nenhuma publicação foi inventada ou coletada.");
      }
      if (!source.feed_url) throw new Error("Fonte sem URL de feed.");
      const xml = await fetchFeed(source.feed_url);
      const items = parseFeed(xml);
      return { source, items, started, error: null as string | null };
    } catch (error) {
      return { source, items: [], started, error: messageOf(error) };
    }
  });

  let itemsFound = 0;
  let itemsNew = 0;
  let itemsDuplicate = 0;
  let errors = 0;
  const fresh: { id: string; title: string; sourceId: string; searchText: string }[] = [];

  for (const result of fetched) {
    if (result.error) {
      errors += 1;
      const retryAt = /429|limite/i.test(result.error) ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await sql.query(
        `update sources
         set last_error_at = now(), last_error_message = $2, next_poll_at = $3, updated_at = now()
         where id = $1`,
        [result.source.id, clip(result.error, 300), retryAt],
      );
      await finishRun(result.source.id, result.started, "error", 0, 0, 0, result.error);
      log("ingest.source_error", { sourceId: result.source.id, message: clip(result.error, 180) });
      continue;
    }

    let found = 0;
    let created = 0;
    let duplicate = 0;
    for (const item of result.items) {
      found += 1;
      try {
        if (!coversPolitics(`${item.title} ${item.description}`)) {
          duplicate += 1;
          continue;
        }
        const outcome = await upsertItem(result.source, item);
        if (outcome.kind === "new") {
          created += 1;
          fresh.push(outcome.fresh);
          publish({ type: "article.created", id: outcome.fresh.id, title: outcome.fresh.title, sourceId: result.source.id });
        } else if (outcome.kind === "updated") {
          publish({ type: "article.updated", id: outcome.id });
          duplicate += 1;
        } else {
          duplicate += 1;
        }
      } catch (error) {
        if (isUniqueViolation(error)) duplicate += 1;
        else log("ingest.item_error", { sourceId: result.source.id, message: messageOf(error) });
      }
    }

    await sql.query(
      `update sources
       set last_success_at = now(), last_error_at = null, last_error_message = null,
           next_poll_at = null, updated_at = now()
       where id = $1`,
      [result.source.id],
    );
    await finishRun(result.source.id, result.started, "success", found, created, duplicate, null);
    itemsFound += found;
    itemsNew += created;
    itemsDuplicate += duplicate;
    log("ingest.source_ok", { sourceId: result.source.id, found, created, duplicate, ms: Date.now() - result.started });
  }

  if (fresh.length) {
    await linkTopics(fresh);
    await evaluateAlerts(fresh);
    await clusterNew(fresh.map((item) => item.id));
  }

  return {
    ran: true,
    sourcesChecked: sources.length,
    itemsFound,
    itemsNew,
    itemsDuplicate,
    errors,
  };
}

async function upsertItem(
  source: SourceRow,
  item: { externalId: string; url: string; title: string; description: string; publishedAt: Date | null; imageUrl: string | null },
): Promise<
  | { kind: "new"; fresh: { id: string; title: string; sourceId: string; searchText: string } }
  | { kind: "updated"; id: string }
  | { kind: "duplicate" }
> {
  const canonical = canonicalUrl(item.url);
  assertPublicHttpUrl(canonical);
  const hash = contentHash(canonical, item.title);
  const excerpt = clip(item.description, 360);
  const searchText = fold(`${item.title} ${item.description}`).slice(0, 2000);
  const category = "Política";
  const id = crypto.randomUUID();
  const stamp = new Date().toISOString();
  const imageUrl = safeImageUrl(item.imageUrl, canonical);
  const sql = await getSql();
  const existing = await sql.query<{ id: string }>(
    `select id from articles where source_id = $1 and external_id = $2`,
    [source.id, item.externalId],
  );
  const rows = await sql.query<{ id: string }>(
    `insert into articles (
       id, source_id, external_id, url, canonical_url, title, description, content_excerpt,
       published_at, discovered_at, language, content_hash, search_text, search_vector, image_url,
       created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, now(), 'pt', $10, $11, to_tsvector('simple', $11), $12,
       $13::timestamptz, $13::timestamptz
     )
     on conflict (source_id, external_id) do update set
       url = excluded.url,
       canonical_url = excluded.canonical_url,
       title = excluded.title,
       description = excluded.description,
       content_excerpt = excluded.content_excerpt,
       published_at = coalesce(excluded.published_at, articles.published_at),
       content_hash = excluded.content_hash,
       search_text = excluded.search_text,
       search_vector = to_tsvector('simple', excluded.search_text),
       image_url = coalesce(excluded.image_url, articles.image_url),
       updated_at = now()
     where articles.content_hash is distinct from excluded.content_hash
        or articles.description is distinct from excluded.description
     returning id`,
    [
      id,
      source.id,
      item.externalId,
      item.url.slice(0, 1500),
      canonical.slice(0, 1500),
      item.title,
      item.description,
      excerpt,
      item.publishedAt ? item.publishedAt.toISOString() : null,
      hash,
      searchText,
      imageUrl,
      stamp,
    ],
  );
  if (!rows.length) return { kind: "duplicate" };
  const savedId = rows[0]?.id ?? id;
  if (!existing.length) {
    await sql.query(
      `insert into article_analysis (
         article_id, category, entities_json, model_provider, model_version, prompt_version,
         processing_status, processed_at
       ) values ($1, $2, '[]'::jsonb, 'rules', 'heuristic-v1', 'rules-v1', 'rules', now())
       on conflict (article_id) do nothing`,
      [savedId, category],
    );
    return { kind: "new", fresh: { id: savedId, title: item.title, sourceId: source.id, searchText } };
  }
  return { kind: "updated", id: savedId };
}

async function linkTopics(fresh: { id: string; searchText: string }[]): Promise<void> {
  const sql = await getSql();
  const topics = await sql.query<{ id: string; keywords: unknown; exclusions: unknown }>(
    `select id, keywords, exclusions from topics where enabled = true`,
  );
  for (const article of fresh) {
    for (const topic of topics) {
      const exclusions = asTextArray(topic.exclusions).map((word) => fold(word));
      if (exclusions.some((word) => word && article.searchText.includes(word))) continue;
      const keywords = asTextArray(topic.keywords).map((word) => fold(word));
      if (!keywords.some((word) => word && article.searchText.includes(word))) continue;
      await sql.query(
        `insert into article_topics (article_id, topic_id) values ($1, $2) on conflict do nothing`,
        [article.id, topic.id],
      );
    }
  }
}

async function evaluateAlerts(fresh: { id: string; searchText: string }[]): Promise<void> {
  const sql = await getSql();
  const alerts = await sql.query<{ id: string; topic_id: string | null; query: string | null }>(
    `select id, topic_id, query from alerts where enabled = true limit 500`,
  );
  if (!alerts.length) return;
  for (const article of fresh) {
    const topicIds = new Set(
      (
        await sql.query<{ topic_id: string }>(`select topic_id from article_topics where article_id = $1`, [article.id])
      ).map((row) => row.topic_id),
    );
    for (const alert of alerts) {
      const tokens = alert.query ? fold(alert.query).split(/[^a-z0-9]+/).filter((token) => token.length > 2) : [];
      const queryHit = tokens.length > 0 && tokens.every((token) => article.searchText.includes(token));
      const topicHit = alert.topic_id ? topicIds.has(alert.topic_id) : false;
      if (!queryHit && !topicHit) continue;
      await sql.query(
        `insert into alert_hits (id, alert_id, article_id) values ($1, $2, $3) on conflict do nothing`,
        [crypto.randomUUID(), alert.id, article.id],
      );
    }
  }
}

async function clusterNew(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const sql = await getSql();
  const recent = await sql.query<RecentArticle>(
    `select a.id, a.title, a.canonical_url, a.source_id, a.published_at, a.discovered_at, ea.event_id
     from articles a
     left join event_articles ea on ea.article_id = a.id
     where a.discovered_at > now() - interval '72 hours'
     order by coalesce(a.published_at, a.discovered_at) asc
     limit 400`,
  );
  const wanted = new Set(ids);
  const eventOf = new Map<string, string>();
  for (const article of recent) if (article.event_id) eventOf.set(article.id, article.event_id);
  const touched = new Set<string>();

  for (const article of recent) {
    if (!wanted.has(article.id) || eventOf.has(article.id)) continue;
    let best: { id: string; score: number; eventId: string | null } | null = null;
    for (const other of recent) {
      if (other.id === article.id) continue;
      const score = storySimilarity(
        { title: article.title, canonicalUrl: article.canonical_url },
        { title: other.title, canonicalUrl: other.canonical_url },
      );
      if (score < 1 && article.source_id === other.source_id) continue;
      if (score < CLUSTER_THRESHOLD) continue;
      if (score < 1 && Math.abs(timeOf(article) - timeOf(other)) > WINDOW_MS) continue;
      const eventId = eventOf.get(other.id) ?? null;
      if (
        !best ||
        score > best.score ||
        (score === best.score && !best.eventId && eventId)
      ) {
        best = { id: other.id, score, eventId };
      }
    }
    if (!best) continue;
    const eventId = best.eventId ?? (await createEvent(article, recent.find((item) => item.id === best?.id) ?? article, best.score));
    if (best.eventId) {
      await sql.query(
        `insert into event_articles (event_id, article_id, similarity) values ($1, $2, $3) on conflict do nothing`,
        [eventId, article.id, best.score],
      );
    }
    eventOf.set(article.id, eventId);
    if (!best.eventId) eventOf.set(best.id, eventId);
    await refreshEvent(eventId);
    touched.add(eventId);
  }

  for (const eventId of touched) {
    const rows = await sql.query<{ article_count: number }>(`select article_count from events where id = $1`, [eventId]);
    publish({ type: "event.updated", id: eventId, articleCount: Number(rows[0]?.article_count ?? 0) });
  }
}

async function createEvent(left: RecentArticle, right: RecentArticle, score: number): Promise<string> {
  const sql = await getSql();
  const id = crypto.randomUUID();
  const earlier = timeOf(left) <= timeOf(right) ? left : right;
  await sql.query(
    `insert into events (id, title, started_at, updated_at, article_count)
     values ($1, $2, $3, now(), 0)`,
    [id, earlier.title, new Date(timeOf(earlier)).toISOString()],
  );
  await sql.query(
    `insert into event_articles (event_id, article_id, similarity) values ($1, $2, 1), ($1, $3, $4)
     on conflict do nothing`,
    [id, left.id, right.id, score],
  );
  return id;
}

async function refreshEvent(eventId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update events set
       article_count = (select count(*) from event_articles where event_id = $1),
       title = coalesce((
         select a.title from event_articles ea
         join articles a on a.id = ea.article_id
         where ea.event_id = $1
         order by a.published_at asc nulls last
         limit 1
       ), title),
       started_at = (
         select min(coalesce(a.published_at, a.discovered_at))
         from event_articles ea join articles a on a.id = ea.article_id
         where ea.event_id = $1
       ),
       updated_at = now()
     where id = $1`,
    [eventId],
  );
}

async function finishRun(
  sourceId: string,
  started: number,
  status: string,
  found: number,
  created: number,
  duplicate: number,
  error: string | null,
): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into ingestion_runs (
       id, source_id, started_at, finished_at, status, items_found, items_new, items_duplicate, error_message, duration_ms
     ) values ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9)`,
    [
      crypto.randomUUID(),
      sourceId,
      new Date(started).toISOString(),
      status,
      found,
      created,
      duplicate,
      error ? clip(error, 300) : null,
      Date.now() - started,
    ],
  );
}

export async function fetchFeed(feedUrl: string): Promise<string> {
  let currentUrl = assertPublicHttpUrl(feedUrl).toString();
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await readFeed(currentUrl);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Falha ao ler o feed.");
      if (/^HTTP 429/.test(lastError.message) || /^HTTP 4/.test(lastError.message)) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError ?? new Error("Falha ao ler o feed.");
}

async function readFeed(startUrl: string): Promise<string> {
  let currentUrl = startUrl;
  for (let hop = 0; hop < 3; hop += 1) {
    assertPublicHttpUrl(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
        "user-agent": USER_AGENT,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirecionamento sem destino.");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      throw new Error(retry ? `HTTP 429. Retry-After ${retry}` : "HTTP 429");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 2_000_000) throw new Error("Feed grande demais.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 2_000_000) throw new Error("Feed grande demais.");
    const probe = bytes.byteLength
      ? new TextDecoder("iso-8859-1").decode(bytes.slice(0, 120)).toLowerCase()
      : "";
    const xmlEncoding = /encoding=["']([^"']+)["']/.exec(probe)?.[1];
    return decodeFeed(bytes, charsetOf(response.headers.get("content-type")), xmlEncoding);
  }
  throw new Error("Muitos redirecionamentos.");
}

function decodeFeed(bytes: ArrayBuffer, headerCharset: string, xmlEncoding?: string): string {
  const wanted = xmlEncoding?.toLowerCase() || headerCharset;
  const latin = wanted === "iso-8859-1" || wanted === "latin1" || wanted === "windows-1252";
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!latin && (utf8.match(/\uFFFD/g)?.length ?? 0) <= 1) return utf8;
  return new TextDecoder("windows-1252").decode(bytes);
}

function charsetOf(header: string | null): string {
  const match = header?.match(/charset=([^;]+)/i);
  const value = match?.[1]?.trim().toLowerCase().replace(/["']/g, "") ?? "utf-8";
  if (value === "iso-8859-1" || value === "latin1") return "iso-8859-1";
  return "utf-8";
}

function asTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const inner = value.replace(/^\{|\}$/g, "");
    if (!inner) return [];
    return inner.split(",").map((part) => part.replace(/^"|"$/g, "").trim());
  }
  return [];
}

function timeOf(article: { published_at: Date | string | null; discovered_at: Date | string }): number {
  const value = article.published_at ?? article.discovered_at;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? Date.now() : time;
}

function isUniqueViolation(error: unknown): boolean {
  const typed = error as { code?: string; message?: string };
  return typed.code === "23505" || /unique|duplicate key/i.test(typed.message ?? "");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Erro desconhecido.";
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await fn(items[currentIndex] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  return results;
}
