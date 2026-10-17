import { articleBody, clip, decodeEntities, stripHtml } from "./text.ts";

export type DraftItem = {
  externalId: string;
  url: string;
  title: string;
  description: string;
  publishedAt: Date | null;
  imageUrl: string | null;
};

export function parseFeed(xml: string): DraftItem[] {
  const sample = xml.slice(0, 800).toLowerCase();
  if (!sample.includes("<rss") && !sample.includes("<feed") && !xml.includes("<item") && !xml.includes("<entry")) {
    throw new Error("A resposta não é um feed RSS ou Atom.");
  }
  const itemChunks = xml.split(/<item\b/i).slice(1);
  const atom = itemChunks.length === 0;
  const chunks = atom ? xml.split(/<entry\b/i).slice(1) : itemChunks;
  const items: DraftItem[] = [];
  for (const chunk of chunks.slice(0, 40)) {
    const block = chunk.split(atom ? /<\/entry>/i : /<\/item>/i)[0] ?? chunk;
    const title = clip(clean(tag(block, "title")), 300);
    let link = atom ? attr(block, "link", "href") : clean(tag(block, "link"));
    if (!link) link = attr(block, "link", "href");
    link = link.trim();
    if (!title || title.length < 2 || !/^https?:\/\//i.test(link)) continue;
    const guid = clean(tag(block, "guid") || tag(block, "id")) || link;
    const raw = encoded(block) || tag(block, "description") || tag(block, "summary") || tag(block, "content");
    const description = articleBody(raw).slice(0, 8000);
    const publishedAt = parseDate(
      clean(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date")),
    );
    items.push({
      externalId: clip(guid, 500),
      url: link,
      title,
      description,
      publishedAt,
      imageUrl:
        attr(block, "media:thumbnail", "url") ||
        attr(block, "media:content", "url") ||
        attr(block, "enclosure", "url") ||
        attr(block, "img", "src") ||
        null,
    });
  }
  return items;
}

export function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return date;
}

function encoded(block: string): string {
  const match = /<content:encoded\b[^>]*>([\s\S]*?)<\/content:encoded>/i.exec(block);
  return match?.[1] ?? "";
}

function clean(value: string): string {
  return stripHtml(unwrap(value));
}

function unwrap(value: string): string {
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(value);
  return decodeEntities((cdata ? cdata[1] : value).trim());
}

function tag(block: string, name: string): string {
  const escaped = escapeRegExp(name);
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, "i").exec(block);
  return match?.[1] ?? "";
}

function attr(block: string, name: string, attribute: string): string {
  const match = new RegExp(
    `<${escapeRegExp(name)}\\b[^>]*\\b${escapeRegExp(attribute)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
    "i",
  ).exec(block);
  return match ? unwrap(match[2]).trim() : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
