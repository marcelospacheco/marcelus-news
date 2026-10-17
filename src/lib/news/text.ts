import { createHash } from "node:crypto";
import { CATEGORIES, type Category } from "./types.ts";

const STOP = new Set([
  "de", "da", "do", "das", "dos", "a", "o", "e", "em", "para", "com", "que",
  "no", "na", "nos", "nas", "um", "uma", "por", "se", "ao", "as", "os", "nao",
  "mais", "sobre", "apos", "entre", "como", "sua", "seu", "foi", "sao", "ser",
  "esta", "este", "isso", "ja", "ou", "the", "of", "and", "para", "pela", "pelo",
  "seu", "sua", "seus", "suas", "ele", "ela", "eles", "elas", "ate", "sem", "sob",
]);

const RULES: { category: Category; words: string[] }[] = [
  { category: "Esportes", words: ["futebol", "gol", "campeonato", "jogador", "tecnico", "olimpiada", "libertadores", "brasileirao", "nba", "tenis"] },
  { category: "Tecnologia", words: ["software", "aplicativo", "inteligencia artificial", "chip", "celular", "startup", "ciber", "internet", "iphone", "google", "microsoft"] },
  { category: "Ciência", words: ["pesquisa", "cientista", "estudo", "universidade", "nasa", "vacina", "laboratorio"] },
  { category: "Saúde", words: ["saude", "hospital", "sus", "doenca", "medico", "medic", "epidemia", "dengue"] },
  { category: "Economia", words: ["inflacao", "juros", "dolar", "pib", "banco central", "selic", "mercado", "bolsa"] },
  { category: "Negócios", words: ["empresa", "fusao", "lucro", "acionista", "investimento", "receita"] },
  { category: "Política", words: ["congresso", "governo", "eleicao", "stf", "senado", "camara", "presidente", "deputado", "ministro", "planalto"] },
  { category: "Segurança pública", words: ["policia", "homicidio", "trafico", "prisao", "crime", "delegacia"] },
  { category: "Meio ambiente", words: ["clima", "amazonia", "desmatamento", "incendio", "ambiental", "chuva", "seca"] },
  { category: "Cultura", words: ["filme", "cinema", "musica", "show", "artista", "festival", "livro", "novela"] },
  { category: "Notícias locais", words: ["prefeitura", "bairro", "municipio", "camara municipal"] },
  { category: "Internacional", words: ["eua", "china", "onu", "ucrania", "gaza", "europa", "israel", "trump"] },
];

export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function namedEntity(name: string, flags = "g"): RegExp {
  return new RegExp("&" + name + ";", flags);
}

export function decodeEntities(value: string): string {
  let out = value;
  for (let i = 0; i < 2; i += 1) {
    const next = out
      .replace(namedEntity("nbsp", "gi"), " ")
      .replace(namedEntity("amp"), "&")
      .replace(namedEntity("lt"), "<")
      .replace(namedEntity("gt"), ">")
      .replace(namedEntity("quot"), '"')
      .replace(namedEntity("apos"), "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, num: string) => codePoint(Number(num)));
    if (next === out) break;
    out = next;
  }
  return out;
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

export function articleBody(value: string): string {
  const marked = decodeEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return marked
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripHtml(value: string): string {
  return decodeEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(title: string): string[] {
  const unique = new Set(
    fold(title)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP.has(token)),
  );
  return [...unique];
}

export function jaccard(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let shared = 0;
  for (const token of left) if (rightSet.has(token)) shared += 1;
  return shared / (left.length + rightSet.size - shared);
}

export const CLUSTER_THRESHOLD = 0.4;

export function storySimilarity(
  left: { title: string; canonicalUrl: string },
  right: { title: string; canonicalUrl: string },
): number {
  if (left.canonicalUrl && left.canonicalUrl === right.canonicalUrl) return 1;
  const a = titleTokens(left.title);
  const b = titleTokens(right.title);
  const rightSet = new Set(b);
  const shared = a.filter((token) => rightSet.has(token)).length;
  if (shared < 2) return 0;
  const score = jaccard(a, b);
  if (a.length <= 3 && b.length <= 3 && score < 0.6) return 0;
  return score;
}

export function contentHash(canonical: string, title: string): string {
  return createHash("sha256").update(`${canonical}\n${fold(title)}`).digest("hex");
}

export function queryTokens(q: string): string[] {
  const tokens = fold(q)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP.has(token))
    .slice(0, 8);
  if (tokens.length) return tokens;
  const raw = fold(q).slice(0, 80);
  return raw.length > 1 ? [raw] : [];
}

export function likePattern(token: string): string {
  return `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function classifyText(text: string, hint?: string | null): Category {
  const hay = fold(text);
  let best: Category = "Geral";
  let bestScore = 0;
  for (const rule of RULES) {
    let score = hint === rule.category ? 2 : 0;
    for (const word of rule.words) if (hay.includes(word)) score += 1;
    if (score > bestScore) {
      best = rule.category;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : "Geral";
}

export function coversPolitics(text: string): boolean {
  const hay = fold(text);
  const election = ["eleic", "urna", "candidato", "candidat", "tse", "campanha", "pleito", "eleitor", "coligac"].some((word) => hay.includes(word));
  const politics = classifyText(text) === "Política" || election || ["congresso", "senado", "camara", "stf", "planalto", "deputad", "ministro", "partido", "governo", "impeach", "votac"].some((word) => hay.includes(word));
  if (!politics) return false;
  const sports = ["futebol", "campeonato", "jogador", "brasileirao", "libertadores"].some((word) => hay.includes(word));
  const hard = ["eleic", "congresso", "senado", "stf", "planalto", "deputad", "urna", "tse", "pleito"].some((word) => hay.includes(word));
  return !(sports && !hard);
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}
