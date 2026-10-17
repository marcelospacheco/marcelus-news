import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx
import psycopg
from psycopg.rows import dict_row

from pulso_collector.feeds import USER_AGENT, parse_feed
from pulso_collector.textutil import clip, content_hash, covers_politics, fold, story_similarity, CLUSTER_THRESHOLD
from pulso_collector.urls import assert_public_http_url, canonical_url, safe_image_url

WINDOW = timedelta(hours=36)
Fetch = Callable[[str], str]
_lock = threading.Lock()


def database_url() -> str:
    return (
        os.environ.get("COLLECTOR_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or "postgresql://postgres:postgres@127.0.0.1:54329/postgres"
    )


def connect() -> psycopg.Connection:
    return psycopg.connect(
        database_url(),
        connect_timeout=4,
        row_factory=dict_row,
        prepare_threshold=None,
        autocommit=True,
    )


def collect(force: bool = False, fetch: Fetch | None = None) -> dict[str, int | bool]:
    acquired = _lock.acquire(timeout=35 if force else 0)
    if not acquired:
        return _report(False, 0, 0, 0, 0, busy=True)
    try:
        return _collect(force, fetch or fetch_feed)
    finally:
        _lock.release()


def _collect(force: bool, fetch: Fetch) -> dict[str, int | bool]:
    with connect() as conn:
        sources = conn.execute(
            """
            select id, name, type, feed_url, poll_interval_seconds, config
            from sources
            where enabled = true
              and (%s = true or (
                (next_poll_at is null or next_poll_at <= now())
                and (last_attempt_at is null or last_attempt_at <= now() - (poll_interval_seconds * interval '1 second'))
              ))
            order by id
            """,
            (force,),
        ).fetchall()
        if not sources:
            return _report(False, 0, 0, 0, 0)
        for source in sources:
            conn.execute("update sources set last_attempt_at = now(), updated_at = now() where id = %s", (source["id"],))

        fetched = _fetch_all(sources, fetch)
        found = created = duplicate = errors = 0
        fresh: list[dict[str, str]] = []
        for source, items, started, error in fetched:
            if error:
                errors += 1
                retry = datetime.now(timezone.utc) + timedelta(minutes=15) if "429" in error or "limite" in error.lower() else None
                conn.execute(
                    """
                    update sources
                    set last_error_at = now(), last_error_message = %s, next_poll_at = %s, updated_at = now()
                    where id = %s
                    """,
                    (clip(error, 300), retry, source["id"]),
                )
                _finish(conn, source["id"], started, "error", 0, 0, 0, error)
                continue
            source_found = source_new = source_dup = 0
            for item in items:
                source_found += 1
                if not covers_politics(f"{item['title']} {item.get('description') or ''}"):
                    source_dup += 1
                    continue
                try:
                    outcome = _upsert(conn, source, item)
                    if outcome["kind"] == "new":
                        source_new += 1
                        fresh.append(outcome["fresh"])
                    else:
                        source_dup += 1
                except psycopg.errors.UniqueViolation:
                    source_dup += 1
            conn.execute(
                """
                update sources
                set last_success_at = now(), last_error_at = null, last_error_message = null,
                    next_poll_at = null, updated_at = now()
                where id = %s
                """,
                (source["id"],),
            )
            _finish(conn, source["id"], started, "success", source_found, source_new, source_dup, None)
            found += source_found
            created += source_new
            duplicate += source_dup
        if fresh:
            _link_topics(conn, fresh)
            _alerts(conn, fresh)
            _cluster(conn, [item["id"] for item in fresh])
        report = _report(True, len(sources), found, created, duplicate, errors)
        print(
            f"pulso.collector.done sources={report['sourcesChecked']} found={found} new={created} duplicate={duplicate} errors={errors}",
            flush=True,
        )
        return report


def _fetch_all(sources: list[dict], fetch: Fetch) -> list[tuple]:
    def one(source: dict) -> tuple:
        started = datetime.now(timezone.utc)
        try:
            if source["type"] not in ("rss", "atom"):
                raise RuntimeError("Conector sem credencial oficial. Nenhuma publicação foi inventada ou coletada.")
            if not source["feed_url"]:
                raise RuntimeError("Fonte sem URL de feed.")
            xml = fetch(source["feed_url"])
            return source, parse_feed(xml), started, None
        except Exception as error:
            return source, [], started, str(error)

    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(one, sources))


def fetch_feed(feed_url: str) -> str:
    current = assert_public_http_url(feed_url)
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            return _read_feed(current)
        except Exception as error:
            last_error = error
            message = str(error)
            if message.startswith("HTTP 429") or message.startswith("HTTP 4"):
                break
            if attempt == 0:
                continue
    raise last_error or RuntimeError("Falha ao ler o feed.")


def _read_feed(start: str) -> str:
    current = start
    headers = {
        "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
        "user-agent": USER_AGENT,
    }
    with httpx.Client(timeout=12, follow_redirects=False, headers=headers) as client:
        for _hop in range(3):
            assert_public_http_url(current)
            response = client.get(current)
            if 300 <= response.status_code < 400:
                location = response.headers.get("location")
                if not location:
                    raise RuntimeError("Redirecionamento sem destino.")
                current = str(httpx.URL(current).join(location))
                continue
            if response.status_code == 429:
                raise RuntimeError("HTTP 429")
            if response.status_code >= 400:
                raise RuntimeError(f"HTTP {response.status_code}")
            if len(response.content) > 2_000_000:
                raise RuntimeError("Feed grande demais.")
            return _decode(response.content, response.headers.get("content-type"))
    raise RuntimeError("Muitos redirecionamentos.")


def _decode(payload: bytes, content_type: str | None) -> str:
    header = ""
    if content_type:
        match = re.search(r"charset=([^;]+)", content_type, flags=re.I)
        if match:
            header = match.group(1).strip().strip("\"'").lower()
    probe = payload[:200].decode("latin1", errors="ignore")
    declared_match = re.search(r"encoding=[\"']([^\"']+)[\"']", probe, flags=re.I)
    wanted = (declared_match.group(1) if declared_match else header).lower()
    if wanted in {"iso-8859-1", "latin1", "windows-1252"}:
        return payload.decode("windows-1252", errors="replace")
    text = payload.decode("utf-8", errors="replace")
    if text.count("\ufffd") > 1:
        return payload.decode("windows-1252", errors="replace")
    return text


def _upsert(conn: psycopg.Connection, source: dict, item: dict) -> dict:
    canonical = canonical_url(str(item["url"]))
    assert_public_http_url(canonical)
    digest = content_hash(canonical, str(item["title"]))
    description = str(item.get("description") or "")
    search = fold(f"{item['title']} {description}")[:2000]
    category = "Política"
    article_id = str(uuid.uuid4())
    existing = conn.execute(
        "select id from articles where source_id = %s and external_id = %s",
        (source["id"], item["external_id"]),
    ).fetchone()
    row = conn.execute(
        """
        insert into articles (
          id, source_id, external_id, url, canonical_url, title, description, content_excerpt,
          published_at, discovered_at, language, content_hash, search_text, search_vector, image_url,
          created_at, updated_at
        ) values (
          %s, %s, %s, %s, %s, %s, %s, %s,
          %s, now(), 'pt', %s, %s, to_tsvector('simple', %s), %s,
          now(), now()
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
        returning id
        """,
        (
            article_id,
            source["id"],
            str(item["external_id"])[:500],
            str(item["url"])[:1500],
            canonical[:1500],
            str(item["title"])[:300],
            description[:8000],
            clip(description, 360),
            item.get("published_at"),
            digest,
            search,
            search,
            safe_image_url(item.get("image_url") if isinstance(item.get("image_url"), str) else None, canonical),
        ),
    ).fetchone()
    if not row:
        return {"kind": "duplicate"}
    saved = row["id"]
    if not existing:
        conn.execute(
            """
            insert into article_analysis (
              article_id, category, entities_json, model_provider, model_version, prompt_version,
              processing_status, processed_at
            ) values (%s, %s, '[]'::jsonb, 'rules', 'heuristic-v1', 'rules-v1', 'rules', now())
            on conflict (article_id) do nothing
            """,
            (saved, category),
        )
        return {"kind": "new", "fresh": {"id": saved, "title": str(item["title"]), "source_id": source["id"], "search_text": search}}
    return {"kind": "updated", "id": saved}


def _words(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        inner = value.strip("{}")
        return [part.strip().strip('"') for part in inner.split(",") if part.strip()]
    return []


def _link_topics(conn: psycopg.Connection, fresh: list[dict[str, str]]) -> None:
    topics = conn.execute("select id, keywords, exclusions from topics where enabled = true").fetchall()
    for article in fresh:
        for topic in topics:
            exclusions = [fold(word) for word in _words(topic["exclusions"])]
            if any(word and word in article["search_text"] for word in exclusions):
                continue
            keywords = [fold(word) for word in _words(topic["keywords"])]
            if not any(word and word in article["search_text"] for word in keywords):
                continue
            conn.execute(
                "insert into article_topics (article_id, topic_id) values (%s, %s) on conflict do nothing",
                (article["id"], topic["id"]),
            )


def _alerts(conn: psycopg.Connection, fresh: list[dict[str, str]]) -> None:
    alerts = conn.execute("select id, topic_id, query from alerts where enabled = true limit 500").fetchall()
    if not alerts:
        return
    for article in fresh:
        topics = {
            row["topic_id"]
            for row in conn.execute("select topic_id from article_topics where article_id = %s", (article["id"],)).fetchall()
        }
        for alert in alerts:
            tokens = [token for token in re.split(r"[^a-z0-9]+", fold(alert["query"] or "")) if len(token) > 2]
            query_hit = bool(tokens) and all(token in article["search_text"] for token in tokens)
            topic_hit = bool(alert["topic_id"] and alert["topic_id"] in topics)
            if not query_hit and not topic_hit:
                continue
            conn.execute(
                "insert into alert_hits (id, alert_id, article_id) values (%s, %s, %s) on conflict do nothing",
                (str(uuid.uuid4()), alert["id"], article["id"]),
            )


def _cluster(conn: psycopg.Connection, ids: list[str]) -> None:
    if not ids:
        return
    recent = conn.execute(
        """
        select a.id, a.title, a.canonical_url, a.source_id, a.published_at, a.discovered_at, ea.event_id
        from articles a
        left join event_articles ea on ea.article_id = a.id
        where a.discovered_at > now() - interval '72 hours'
        order by coalesce(a.published_at, a.discovered_at) asc
        limit 400
        """
    ).fetchall()
    wanted = set(ids)
    event_of = {row["id"]: row["event_id"] for row in recent if row["event_id"]}
    for article in recent:
        if article["id"] not in wanted or article["id"] in event_of:
            continue
        best = None
        for other in recent:
            if other["id"] == article["id"]:
                continue
            score = story_similarity(
                {"title": article["title"], "canonical_url": article["canonical_url"]},
                {"title": other["title"], "canonical_url": other["canonical_url"]},
            )
            if score < 1 and article["source_id"] == other["source_id"]:
                continue
            if score < CLUSTER_THRESHOLD:
                continue
            if score < 1 and abs(_time_of(article) - _time_of(other)) > WINDOW.total_seconds() * 1000:
                continue
            event_id = event_of.get(other["id"])
            if best is None or score > best["score"] or (score == best["score"] and not best["event_id"] and event_id):
                best = {"id": other["id"], "score": score, "event_id": event_id, "row": other}
        if not best:
            continue
        if best["event_id"]:
            conn.execute(
                "insert into event_articles (event_id, article_id, similarity) values (%s, %s, %s) on conflict do nothing",
                (best["event_id"], article["id"], best["score"]),
            )
            event_of[article["id"]] = best["event_id"]
            _refresh_event(conn, best["event_id"])
        else:
            event_id = _create_event(conn, article, best["row"], best["score"])
            event_of[article["id"]] = event_id
            event_of[best["id"]] = event_id


def _create_event(conn: psycopg.Connection, left: dict, right: dict, score: float) -> str:
    event_id = str(uuid.uuid4())
    earlier = left if _time_of(left) <= _time_of(right) else right
    conn.execute(
        "insert into events (id, title, started_at, updated_at, article_count) values (%s, %s, %s, now(), 0)",
        (event_id, earlier["title"], datetime.fromtimestamp(_time_of(earlier) / 1000, timezone.utc)),
    )
    conn.execute(
        """
        insert into event_articles (event_id, article_id, similarity) values
          (%s, %s, 1), (%s, %s, %s)
        on conflict do nothing
        """,
        (event_id, left["id"], event_id, right["id"], score),
    )
    _refresh_event(conn, event_id)
    return event_id


def _refresh_event(conn: psycopg.Connection, event_id: str) -> None:
    conn.execute(
        """
        update events set
          article_count = (select count(*) from event_articles where event_id = %s),
          title = coalesce((
            select a.title from event_articles ea
            join articles a on a.id = ea.article_id
            where ea.event_id = %s
            order by a.published_at asc nulls last
            limit 1
          ), title),
          started_at = (
            select min(coalesce(a.published_at, a.discovered_at))
            from event_articles ea join articles a on a.id = ea.article_id
            where ea.event_id = %s
          ),
          updated_at = now()
        where id = %s
        """,
        (event_id, event_id, event_id, event_id),
    )


def _finish(conn, source_id, started, status, found, created, duplicate, error) -> None:
    duration = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    conn.execute(
        """
        insert into ingestion_runs (
          id, source_id, started_at, finished_at, status, items_found, items_new, items_duplicate, error_message, duration_ms
        ) values (%s, %s, %s, now(), %s, %s, %s, %s, %s, %s)
        """,
        (str(uuid.uuid4()), source_id, started, status, found, created, duplicate, clip(error, 300) if error else None, duration),
    )


def _time_of(article: dict) -> float:
    value = article.get("published_at") or article.get("discovered_at")
    if isinstance(value, datetime):
        return value.timestamp() * 1000
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).timestamp() * 1000
        except ValueError:
            return datetime.now(timezone.utc).timestamp() * 1000
    return datetime.now(timezone.utc).timestamp() * 1000


def _report(ran: bool, sources: int, found: int, created: int, duplicate: int, errors: int = 0, busy: bool = False) -> dict:
    return {
        "ran": ran,
        "sourcesChecked": sources,
        "itemsFound": found,
        "itemsNew": created,
        "itemsDuplicate": duplicate,
        "errors": errors,
        "busy": busy,
    }
