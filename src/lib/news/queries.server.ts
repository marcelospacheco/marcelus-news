import { getSql, type Sql } from "@/lib/db";
import { ensureIngest, fetchFeed } from "./ingest.server";
import { parseFeed } from "./rss";
import { clip, fold, likePattern, queryTokens, storySimilarity, stripHtml } from "./text";
import { PAGE_SIZE, type ArticleCard, type Entity, type FeedSearch } from "./types";
import { assertPublicHttpUrl } from "./url";

let lastEmptyIngest = 0;
let excerptsSanitized = false;

async function sanitizeStoredText(sql: Sql): Promise<void> {
  if (excerptsSanitized) return;
  excerptsSanitized = true;
  const rows = await sql.query<{ id: string; title: string; description: string | null; content_excerpt: string | null }>(
    `select id, title, description, content_excerpt from articles
     where title like '%&%;%' or description like '%&%;%' or content_excerpt like '%&%;%'
        or description like '%<%>%' or content_excerpt like '%<%>%'
     limit 400`,
  );
  for (const row of rows) {
    const title = stripHtml(row.title).slice(0, 300);
    const description = stripHtml(row.description ?? "");
    const excerpt = clip(description, 360);
    if (title === row.title && description === (row.description ?? "") && excerpt === (row.content_excerpt ?? "")) continue;
    const searchText = fold(`${title} ${description}`).slice(0, 2000);
    await sql.query(
      `update articles
       set title = $2, description = $3, content_excerpt = $4, search_text = $5,
           search_vector = to_tsvector('simple', $5), updated_at = now()
       where id = $1`,
      [row.id, title, description, excerpt, searchText],
    );
  }
}

export type FeedPayload = {
  articles: ArticleCard[];
  total: number;
  page: number;
  pageSize: number;
  sources: { id: string; name: string }[];
  categories: { category: string; count: number }[];
  events: { id: string; title: string; articleCount: number; sourceCount: number }[];
  sourceProblems: number;
};

export async function getFeed(search: FeedSearch): Promise<FeedPayload> {
  const sql = await getSql();
  await sanitizeStoredText(sql);
  const countRows = await sql.query<{ n: number }>(`select count(*)::int as n from articles`);
  if ((countRows[0]?.n ?? 0) === 0) {
    const now = Date.now();
    if (now - lastEmptyIngest > 60_000) {
      lastEmptyIngest = now;
      await ensureIngest(true).catch(() => undefined);
    }
  } else {
    void ensureIngest(false).catch(() => undefined);
  }
  await sql.query(
    `delete from events where id in (
       select e.id from events e
       join event_articles ea on ea.event_id = e.id
       join articles a on a.id = ea.article_id
       group by e.id
       having count(distinct a.source_id) < 2
     )`,
  );
  const built = buildFilters(search);
  const rank = search.sort === "relevance" && search.q ? `${escapeLike(fold(search.q))}%` : null;
  const params = [...built.params];
  let order = "a.published_at desc nulls last, a.discovered_at desc";
  if (rank) {
    params.push(rank);
    order = `case when a.search_text like $${params.length} escape '\\' then 0 else 1 end, ${order}`;
  }
  const limit = PAGE_SIZE;
  const offset = (search.page - 1) * PAGE_SIZE;
  params.push(limit, offset);
  const articles = await sql.query<ArticleRow>(
    `${ARTICLE_SELECT}
     where ${built.where}
     order by ${order}
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const totalRows = await sql.query<{ n: number }>(
    `select count(*)::int as n
     from articles a
     join sources s on s.id = a.source_id
     left join article_analysis n on n.article_id = a.id
     where ${built.where}`,
    built.params,
  );
  const sources = await sql.query<{ id: string; name: string }>(
    `select id, name from sources where enabled and type in ('rss', 'atom') order by name`,
  );
  const categories = await sql.query<{ category: string; count: number }>(
    `select n.category, count(*)::int as count
     from articles a
     join article_analysis n on n.article_id = a.id
     where n.category is not null and n.category <> ''
       and ${POLITICS}
     group by n.category
     order by count desc`,
  );
  const events = await sql.query<{ id: string; title: string; article_count: number; source_count: number }>(
    `select e.id, e.title, e.article_count,
            (select count(distinct a.source_id)::int
             from event_articles ea join articles a on a.id = ea.article_id
             where ea.event_id = e.id) as source_count
     from events e
     where e.article_count >= 2
       and exists (
         select 1 from event_articles pea
         join articles a on a.id = pea.article_id
         left join article_analysis n on n.article_id = a.id
         where pea.event_id = e.id and ${POLITICS}
       )
     order by e.updated_at desc
     limit 6`,
  );
  const problems = await sql.query<{ n: number }>(
    `select count(*)::int as n from sources
     where enabled and type in ('rss','atom')
       and last_error_at is not null
       and (last_success_at is null or last_error_at > last_success_at)`,
  );
  return {
    articles: articles.map(toCard),
    total: totalRows[0]?.n ?? 0,
    page: search.page,
    pageSize: PAGE_SIZE,
    sources,
    categories,
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      articleCount: event.article_count,
      sourceCount: event.source_count,
    })),
    sourceProblems: problems[0]?.n ?? 0,
  };
}

export async function getArticle(id: string) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return null;
  const sql = await getSql();
  const rows = await sql.query<ArticleRow & { entities_json: unknown; description: string | null }>(
    `select a.id, a.source_id, s.name as source_name, a.url, a.canonical_url, a.title, a.description,
            a.content_excerpt, a.published_at, a.discovered_at, a.language, a.image_url,
            n.summary, n.category, n.model_provider, n.processing_status, ea.event_id, n.entities_json
     from articles a
     join sources s on s.id = a.source_id
     left join article_analysis n on n.article_id = a.id
     left join event_articles ea on ea.article_id = a.id
     where a.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const related = row.event_id
    ? (
        await sql.query<ArticleRow>(
          `${ARTICLE_SELECT}
           where ea.event_id = $1 and a.id <> $2
           order by a.published_at asc nulls last
           limit 12`,
          [row.event_id, row.id],
        )
      ).map(toCard)
    : [];
  return { ...toCard(row), body: row.description ?? row.content_excerpt ?? "", entities: asEntities(row.entities_json), related };
}

export async function listEvents() {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    title: string;
    summary: string | null;
    summary_provider: string | null;
    article_count: number;
    source_count: number;
    started_at: Date | string | null;
    updated_at: Date | string;
  }>(
    `select e.id, e.title, e.summary, e.summary_provider, e.article_count, e.started_at, e.updated_at,
            (select count(distinct a.source_id)::int
             from event_articles ea join articles a on a.id = ea.article_id
             where ea.event_id = e.id) as source_count
     from events e
     where e.article_count >= 2
       and exists (
         select 1 from event_articles pea
         join articles a on a.id = pea.article_id
         left join article_analysis n on n.article_id = a.id
         where pea.event_id = e.id and ${POLITICS}
       )
     order by e.updated_at desc
     limit 40`,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    summaryProvider: row.summary_provider,
    articleCount: row.article_count,
    sourceCount: row.source_count,
    startedAt: iso(row.started_at),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  }));
}

export async function getEvent(id: string) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return null;
  const sql = await getSql();
  const events = await sql.query<{
    id: string;
    title: string;
    summary: string | null;
    summary_provider: string | null;
    article_count: number;
    started_at: Date | string | null;
  }>(
    `select id, title, summary, summary_provider, article_count, started_at from events where id = $1`,
    [id],
  );
  const event = events[0];
  if (!event) return null;
  const articles = (
    await sql.query<ArticleRow>(
      `${ARTICLE_SELECT}
       where ea.event_id = $1
       order by a.published_at asc nulls last, a.discovered_at asc`,
      [id],
    )
  ).map(toCard);
  let lowOverlap = false;
  for (let i = 0; i < articles.length; i += 1) {
    for (let j = i + 1; j < articles.length; j += 1) {
      const score = storySimilarity(
        { title: articles[i]?.excerpt || articles[i]?.title || "", canonicalUrl: articles[i]?.canonicalUrl || "" },
        { title: articles[j]?.excerpt || articles[j]?.title || "", canonicalUrl: "different" },
      );
      if (score < 0.2) lowOverlap = true;
    }
  }
  const sources = [...new Set(articles.map((article) => article.sourceName))];
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    summaryProvider: event.summary_provider,
    articleCount: event.article_count,
    startedAt: iso(event.started_at),
    articles,
    sources,
    lowOverlap,
  };
}

export async function listTopics() {
  const sql = await getSql();
  const rows = await sql.query<{ id: string; name: string; keywords: unknown; article_count: number }>(
    `select t.id, t.name, t.keywords, count(at.article_id)::int as article_count
     from topics t
     left join article_topics at on at.topic_id = t.id
     where t.user_id is null and t.enabled = true
     group by t.id
     order by t.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    keywords: asTextArray(row.keywords),
    articleCount: row.article_count,
  }));
}

export async function listSourceBoard() {
  const sql = await getSql();
  const rows = await sql.query<SourceState>(
    `select id, name, type, enabled, poll_interval_seconds, last_success_at, last_error_at, last_attempt_at, config
     from sources order by enabled desc, name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    status: sourceStatus(row),
    lastSuccessAt: iso(row.last_success_at),
  }));
}

export async function getAdminDesk() {
  const sql = await getSql();
  const sources = await sql.query<SourceState & { feed_url: string | null; last_error_message: string | null }>(
    `select id, name, type, enabled, feed_url, poll_interval_seconds, last_success_at, last_error_at,
            last_attempt_at, last_error_message, config
     from sources order by name`,
  );
  const runs = await sql.query<{
    id: string;
    source_id: string | null;
    status: string;
    items_found: number;
    items_new: number;
    items_duplicate: number;
    error_message: string | null;
    duration_ms: number | null;
    started_at: Date | string;
  }>(
    `select id, source_id, status, items_found, items_new, items_duplicate, error_message, duration_ms, started_at
     from ingestion_runs order by started_at desc limit 24`,
  );
  const metrics = await sql.query<{
    articles: number;
    new_24h: number;
    errors_24h: number;
    ai_calls: number;
    ai_tokens: number;
  }>(
    `select
       (select count(*)::int from articles) as articles,
       (select count(*)::int from articles where discovered_at > now() - interval '24 hours') as new_24h,
       (select count(*)::int from ingestion_runs where status = 'error' and started_at > now() - interval '24 hours') as errors_24h,
       (select count(*)::int from article_analysis where model_provider = 'xai') as ai_calls,
       (select coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)::int from article_analysis where model_provider = 'xai') as ai_tokens`,
  );
  return {
    sources: sources.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled,
      feedUrl: row.feed_url,
      status: sourceStatus(row),
      lastSuccessAt: iso(row.last_success_at),
      lastErrorAt: iso(row.last_error_at),
      lastErrorMessage: row.last_error_message,
      pollIntervalSeconds: row.poll_interval_seconds,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      sourceId: run.source_id,
      status: run.status,
      itemsFound: run.items_found,
      itemsNew: run.items_new,
      itemsDuplicate: run.items_duplicate,
      errorMessage: run.error_message,
      durationMs: run.duration_ms,
      startedAt: iso(run.started_at),
    })),
    metrics: metrics[0] ?? { articles: 0, new_24h: 0, errors_24h: 0, ai_calls: 0, ai_tokens: 0 },
    ai: process.env.XAI_API_KEY ? "available" : "unavailable",
  };
}

export async function getMyDesk(userId: string) {
  const sql = await getSql();
  const [topics, alerts, searches, hits] = await Promise.all([
    sql.query<{ id: string; name: string; keywords: unknown; exclusions: unknown; enabled: boolean }>(
      `select id, name, keywords, exclusions, enabled from topics where user_id = $1 order by created_at desc`,
      [userId],
    ),
    sql.query<{ id: string; name: string; query: string | null; topic_id: string | null; enabled: boolean }>(
      `select id, name, query, topic_id, enabled from alerts where user_id = $1 order by created_at desc`,
      [userId],
    ),
    sql.query<{ id: string; name: string; query: string; filters_json: unknown }>(
      `select id, name, query, filters_json from saved_searches where user_id = $1 order by created_at desc limit 20`,
      [userId],
    ),
    sql.query<{ id: string; title: string; alert_name: string; created_at: Date | string }>(
      `select a.id, a.title, al.name as alert_name, h.created_at
       from alert_hits h
       join alerts al on al.id = h.alert_id
       join articles a on a.id = h.article_id
       where al.user_id = $1
       order by h.created_at desc
       limit 20`,
      [userId],
    ),
  ]);
  return {
    topics: topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      keywords: asTextArray(topic.keywords),
      exclusions: asTextArray(topic.exclusions),
      enabled: topic.enabled,
    })),
    alerts: alerts.map((alert) => ({
      id: alert.id,
      name: alert.name,
      query: alert.query,
      topicId: alert.topic_id,
      enabled: alert.enabled,
    })),
    searches: searches.map((search) => ({
      id: search.id,
      name: search.name,
      query: search.query,
      filters: search.filters_json && typeof search.filters_json === "object" ? search.filters_json : {},
    })),
    hits: hits.map((hit) => ({
      articleId: hit.id,
      title: hit.title,
      alertName: hit.alert_name,
      createdAt: iso(hit.created_at),
    })),
  };
}

export async function createSource(
  userId: string,
  input: { name: string; feedUrl: string; pollIntervalSeconds: number },
) {
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new Error("Dê um nome à fonte.");
  const feedUrl = assertPublicHttpUrl(input.feedUrl.trim(), true).toString();
  const xml = await fetchFeed(feedUrl);
  const items = parseFeed(xml);
  if (!items.length) throw new Error("O endereço respondeu, mas não há itens de notícia nele.");
  const interval = clampInterval(input.pollIntervalSeconds);
  const id = `src-${crypto.randomUUID().slice(0, 8)}`;
  const sql = await getSql();
  await sql.query(
    `insert into sources (id, name, type, base_url, feed_url, enabled, poll_interval_seconds, config)
     values ($1, $2, 'rss', $3, $4, true, $5, '{}'::jsonb)`,
    [id, name, new URL(feedUrl).origin, feedUrl, interval],
  );
  await audit(sql, userId, "source.create", id, { name });
  return { id };
}

export async function patchSource(
  userId: string,
  id: string,
  input: { enabled?: boolean; name?: string; pollIntervalSeconds?: number },
) {
  if (!/^[a-zA-Z0-9-]{2,80}$/.test(id)) throw new Error("Fonte inválida.");
  const sql = await getSql();
  const existing = await sql.query<{ id: string }>(`select id from sources where id = $1`, [id]);
  if (!existing.length) throw new Error("Fonte não encontrada.");
  if (typeof input.name === "string") {
    const name = input.name.trim().slice(0, 80);
    if (name.length < 2) throw new Error("Nome curto demais.");
    await sql.query(`update sources set name = $2, updated_at = now() where id = $1`, [id, name]);
  }
  if (typeof input.enabled === "boolean") {
    await sql.query(`update sources set enabled = $2, updated_at = now() where id = $1`, [id, input.enabled]);
  }
  if (typeof input.pollIntervalSeconds === "number") {
    await sql.query(`update sources set poll_interval_seconds = $2, updated_at = now() where id = $1`, [
      id,
      clampInterval(input.pollIntervalSeconds),
    ]);
  }
  await audit(sql, userId, "source.patch", id, {
    enabled: input.enabled ?? null,
    name: input.name ?? null,
  });
  return { ok: true };
}

export async function createTopic(
  userId: string,
  input: { name: string; keywords: string; exclusions: string },
) {
  const name = input.name.trim().slice(0, 60);
  const keywords = words(input.keywords);
  const exclusions = words(input.exclusions);
  if (name.length < 2 || !keywords.length) throw new Error("Informe o nome e ao menos uma palavra-chave.");
  const sql = await getSql();
  const id = crypto.randomUUID();
  await sql.query(
    `insert into topics (id, user_id, name, keywords, exclusions) values ($1, $2, $3, $4, $5)`,
    [id, userId, name, keywords, exclusions],
  );
  await audit(sql, userId, "topic.create", id, { name });
  return { id };
}

export async function createAlert(
  userId: string,
  input: { name: string; query: string; topicId: string },
) {
  const name = input.name.trim().slice(0, 80);
  const query = input.query.trim().slice(0, 180);
  const topicId = input.topicId.trim();
  if (name.length < 2) throw new Error("Dê um nome ao alerta.");
  if (!query && !topicId) throw new Error("Use uma busca ou um tema.");
  const sql = await getSql();
  if (topicId) {
    const topic = await sql.query<{ id: string }>(
      `select id from topics where id = $1 and (user_id is null or user_id = $2)`,
      [topicId, userId],
    );
    if (!topic.length) throw new Error("Tema não encontrado.");
  }
  const id = crypto.randomUUID();
  await sql.query(
    `insert into alerts (id, user_id, topic_id, name, query, enabled) values ($1, $2, $3, $4, $5, true)`,
    [id, userId, topicId || null, name, query || null],
  );
  await audit(sql, userId, "alert.create", id, { name });
  return { id };
}

export async function setAlertEnabled(userId: string, id: string, enabled: boolean) {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `update alerts set enabled = $3 where id = $1 and user_id = $2 returning id`,
    [id, userId, enabled],
  );
  if (!rows.length) throw new Error("Alerta não encontrado.");
  return { ok: true };
}

export async function saveSearch(userId: string, input: { name: string; query: string; filters: FeedSearch }) {
  const name = input.name.trim().slice(0, 80) || input.query.trim().slice(0, 80);
  if (!name) throw new Error("Dê um nome à pesquisa.");
  const sql = await getSql();
  const count = await sql.query<{ n: number }>(
    `select count(*)::int as n from saved_searches where user_id = $1`,
    [userId],
  );
  if ((count[0]?.n ?? 0) >= 30) throw new Error("Você já tem 30 pesquisas salvas.");
  const id = crypto.randomUUID();
  await sql.query(
    `insert into saved_searches (id, user_id, name, query, filters_json) values ($1, $2, $3, $4, $5::jsonb)`,
    [id, userId, name, input.query.slice(0, 180), JSON.stringify(input.filters)],
  );
  return { id };
}

export async function deleteSavedSearch(userId: string, id: string) {
  const sql = await getSql();
  await sql.query(`delete from saved_searches where id = $1 and user_id = $2`, [id, userId]);
  return { ok: true };
}

export async function getHealth() {
  const sql = await getSql();
  const rows = await sql.query<{ articles: number; failing: number; enabled: number }>(
    `select
       (select count(*)::int from articles) as articles,
       (select count(*)::int from sources where enabled) as enabled,
       (select count(*)::int from sources
         where enabled and last_error_at is not null
           and (last_success_at is null or last_error_at > last_success_at)) as failing`,
  );
  const failing = rows[0]?.failing ?? 0;
  return {
    status: failing > 0 ? "degraded" : "ok",
    database: "up",
    articles: rows[0]?.articles ?? 0,
    sourcesEnabled: rows[0]?.enabled ?? 0,
    sourcesFailing: failing,
    ai: process.env.XAI_API_KEY ? "available" : "unavailable",
    checkedAt: new Date().toISOString(),
  };
}

const POLITICS = `(
  (
    n.category = 'Política'
    or a.search_text like '%eleic%'
    or a.search_text like '%congress%'
    or a.search_text like '%senado%'
    or a.search_text like '%camara%'
    or a.search_text like '%stf%'
    or a.search_text like '%planalto%'
    or a.search_text like '%deputad%'
    or a.search_text like '%candidato%'
    or a.search_text like '%urna%'
    or a.search_text like '%pleito%'
    or a.search_text like '%governo%'
    or a.search_text like '%ministro%'
    or a.search_text like '%partido%'
    or a.search_text like '%votac%'
    or a.search_text like '%eleitor%'
  )
  and not (
    (
      a.search_text like '%futebol%'
      or a.search_text like '%campeonato%'
      or a.search_text like '%jogador%'
      or a.search_text like '%brasileirao%'
      or a.search_text like '%libertadores%'
    )
    and a.search_text not like '%eleic%'
    and a.search_text not like '%congress%'
    and a.search_text not like '%senado%'
    and a.search_text not like '%stf%'
    and a.search_text not like '%planalto%'
    and a.search_text not like '%deputad%'
    and a.search_text not like '%urna%'
    and a.search_text not like '%pleito%'
  )
)`;

const ARTICLE_SELECT = `select a.id, a.source_id, s.name as source_name, a.url, a.canonical_url, a.title,
  a.content_excerpt, a.published_at, a.discovered_at, a.language, a.image_url,
  n.summary, n.category, n.model_provider, n.processing_status, ea.event_id
  from articles a
  join sources s on s.id = a.source_id
  left join article_analysis n on n.article_id = a.id
  left join event_articles ea on ea.article_id = a.id`;

type ArticleRow = {
  id: string;
  source_id: string;
  source_name: string;
  url: string;
  canonical_url: string;
  title: string;
  content_excerpt: string | null;
  published_at: Date | string | null;
  discovered_at: Date | string;
  language: string;
  image_url: string | null;
  summary: string | null;
  category: string | null;
  model_provider: string | null;
  processing_status: string | null;
  event_id: string | null;
};

type SourceState = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  poll_interval_seconds: number;
  last_success_at: Date | string | null;
  last_error_at: Date | string | null;
  last_attempt_at: Date | string | null;
  config: unknown;
};

function buildFilters(search: FeedSearch): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses = ["true", POLITICS];
  for (const token of queryTokens(search.q)) {
    params.push(likePattern(token));
    clauses.push(`a.search_text ilike $${params.length} escape '\\'`);
  }
  if (search.category) {
    params.push(search.category);
    clauses.push(`n.category = $${params.length}`);
  }
  if (search.source) {
    params.push(search.source);
    clauses.push(`a.source_id = $${params.length}`);
  }
  if (search.language) {
    params.push(search.language);
    clauses.push(`a.language = $${params.length}`);
  }
  if (search.from) {
    params.push(search.from);
    clauses.push(`a.published_at >= $${params.length}::date`);
  }
  if (search.to) {
    params.push(search.to);
    clauses.push(`a.published_at < ($${params.length}::date + interval '1 day')`);
  }
  return { where: clauses.join(" and "), params };
}

function toCard(row: ArticleRow): ArticleCard {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    excerpt: row.content_excerpt ?? "",
    publishedAt: iso(row.published_at),
    discoveredAt: iso(row.discovered_at) ?? new Date().toISOString(),
    language: row.language,
    imageUrl: row.image_url,
    summary: row.summary,
    category: row.category,
    modelProvider: row.model_provider,
    processingStatus: row.processing_status,
    eventId: row.event_id,
  };
}

function sourceStatus(row: SourceState): "off" | "pending" | "ok" | "late" | "error" {
  if (!row.enabled) return "off";
  if (row.type !== "rss" && row.type !== "atom") return "pending";
  if (row.last_error_at && (!row.last_success_at || time(row.last_error_at) > time(row.last_success_at))) return "error";
  if (!row.last_success_at) return "late";
  const age = Date.now() - time(row.last_success_at);
  if (age > row.poll_interval_seconds * 1000 * 2) return "late";
  return "ok";
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function time(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function asEntities(value: unknown): Entity[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = "name" in item && typeof item.name === "string" ? item.name.slice(0, 80) : "";
      const type = "type" in item && typeof item.type === "string" ? item.type.slice(0, 40) : "outro";
      if (!name) return null;
      return { name, type };
    })
    .filter((item): item is Entity => item !== null)
    .slice(0, 16);
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

function words(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/).map((part) => part.trim().toLowerCase()).filter((part) => part.length > 1))].slice(0, 20);
}

function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return 900;
  return Math.min(86_400, Math.max(300, Math.round(value)));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

async function audit(sql: Sql, userId: string, action: string, target: string, detail: Record<string, unknown>) {
  await sql.query(
    `insert into audit_logs (id, user_id, action, target, detail) values ($1, $2, $3, $4, $5::jsonb)`,
    [crypto.randomUUID(), userId, action, target, JSON.stringify(detail)],
  );
}
