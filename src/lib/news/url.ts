const TRACKING = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "at_medium",
  "at_campaign",
  "outputtype",
  "ref",
]);

export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("A URL precisa usar http ou https.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  const entries = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING.has(key.toLowerCase()))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  url.search = entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
  return url.toString();
}

export function assertPublicHttpUrl(raw: string, httpsOnly = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL inválida.");
  }
  if (httpsOnly) {
    if (url.protocol !== "https:") throw new Error("Use um endereço https.");
  } else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Só são permitidos endereços http ou https.");
  }
  if (url.username || url.password) throw new Error("URL com usuário ou senha não é aceita.");
  if (isPrivateHost(url.hostname)) throw new Error("Endereço interno ou local não é permitido.");
  return url;
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host.includes(":")) {
    const head = host.split(":")[0] ?? "";
    if (head === "" || head === "fe80" || head.startsWith("fc") || head.startsWith("fd")) return true;
  }
  return false;
}

export function safeImageUrl(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:") return null;
    assertPublicHttpUrl(url.toString());
    if (url.toString().length > 1000) return null;
    return url.toString();
  } catch {
    return null;
  }
}
