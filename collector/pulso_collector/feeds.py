import re
from datetime import datetime
from html import unescape

from pulso_collector.textutil import clip, plain_body, strip_html

USER_AGENT = "MarcelusNews/1.0 (agregador de politica e eleicoes; credito e link da fonte)"


def parse_feed(xml: str) -> list[dict[str, object]]:
    sample = xml[:800].lower()
    if "<rss" not in sample and "<feed" not in sample and "<item" not in xml and "<entry" not in xml:
        raise ValueError("A resposta não é um feed RSS ou Atom.")
    item_chunks = re.split(r"<item\b", xml, flags=re.I)[1:]
    atom = len(item_chunks) == 0
    chunks = re.split(r"<entry\b", xml, flags=re.I)[1:] if atom else item_chunks
    closer = r"</entry>" if atom else r"</item>"
    items: list[dict[str, object]] = []
    for chunk in chunks[:40]:
        block = re.split(closer, chunk, maxsplit=1, flags=re.I)[0]
        title = clip(clean(tag(block, "title")), 300)
        link = attr(block, "link", "href") if atom else clean(tag(block, "link"))
        if not link:
            link = attr(block, "link", "href")
        link = link.strip()
        if len(title) < 2 or not re.match(r"https?://", link, flags=re.I):
            continue
        guid = clean(tag(block, "guid") or tag(block, "id")) or link
        raw = encoded(block) or tag(block, "description") or tag(block, "summary") or tag(block, "content")
        description = plain_body(raw)[:8000]
        published = parse_date(clean(tag(block, "pubDate") or tag(block, "published") or tag(block, "updated") or tag(block, "dc:date")))
        image = (
            attr(block, "media:thumbnail", "url")
            or attr(block, "media:content", "url")
            or attr(block, "enclosure", "url")
            or attr(block, "img", "src")
            or None
        )
        items.append(
            {
                "external_id": clip(guid, 500),
                "url": link,
                "title": title,
                "description": description,
                "published_at": published,
                "image_url": image,
            }
        )
    return items


def encoded(block: str) -> str:
    match = re.search(r"<content:encoded\b[^>]*>([\s\S]*?)</content:encoded>", block, flags=re.I)
    return match.group(1) if match else ""


def parse_date(raw: str) -> datetime | None:
    if not raw:
        return None
    try:
        date = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            from email.utils import parsedate_to_datetime

            date = parsedate_to_datetime(raw)
        except (TypeError, ValueError, IndexError):
            return None
    if date.year < 1990 or date.year > 2100:
        return None
    return date


def clean(value: str) -> str:
    return strip_html(unescape(unwrap(value)))


def unwrap(value: str) -> str:
    match = re.search(r"<!\[CDATA\[([\s\S]*?)\]\]>", value)
    return (match.group(1) if match else value).strip()


def tag(block: str, name: str) -> str:
    match = re.search(rf"<{re.escape(name)}\b[^>]*>([\s\S]*?)</{re.escape(name)}>", block, flags=re.I)
    return match.group(1) if match else ""


def attr(block: str, name: str, attribute: str) -> str:
    match = re.search(
        rf"<{re.escape(name)}\b[^>]*\b{re.escape(attribute)}\s*=\s*([\"'])([\s\S]*?)\1",
        block,
        flags=re.I,
    )
    return unwrap(match.group(2)).strip() if match else ""
