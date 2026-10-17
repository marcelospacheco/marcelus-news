export const CATEGORIES = [
  "Política",
  "Economia",
  "Tecnologia",
  "Ciência",
  "Saúde",
  "Esportes",
  "Cultura",
  "Segurança pública",
  "Meio ambiente",
  "Negócios",
  "Notícias locais",
  "Internacional",
  "Geral",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const PAGE_SIZE = 12;

export const EMPTY_FEED: FeedSearch = {
  q: "",
  category: "",
  source: "",
  page: 1,
  sort: "date",
  from: "",
  to: "",
  language: "",
};

export type FeedSearch = {
  q: string;
  category: string;
  source: string;
  page: number;
  sort: "date" | "relevance";
  from: string;
  to: string;
  language: string;
};

export type ArticleCard = {
  id: string;
  sourceId: string;
  sourceName: string;
  url: string;
  canonicalUrl: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  discoveredAt: string;
  language: string;
  imageUrl: string | null;
  summary: string | null;
  category: string | null;
  modelProvider: string | null;
  processingStatus: string | null;
  eventId: string | null;
};

export type Entity = { name: string; type: string };

export type IngestReport = {
  ran: boolean;
  sourcesChecked: number;
  itemsFound: number;
  itemsNew: number;
  itemsDuplicate: number;
  errors: number;
};

export function parseFeedSearch(search: Record<string, unknown>): FeedSearch {
  const pageRaw = Number(search.page ?? 1);
  const day = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  const language = search.language === "pt" || search.language === "en" ? search.language : "";
  return {
    q: typeof search.q === "string" ? search.q.slice(0, 180) : "",
    category: typeof search.category === "string" ? search.category.slice(0, 40) : "",
    source: typeof search.source === "string" ? search.source.slice(0, 80) : "",
    page: Number.isFinite(pageRaw) ? Math.min(40, Math.max(1, Math.floor(pageRaw))) : 1,
    sort: search.sort === "relevance" ? "relevance" : "date",
    from: day(search.from),
    to: day(search.to),
    language,
  };
}
