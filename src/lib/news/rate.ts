type Bucket = { start: number; count: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  if (buckets.size > 300) buckets.clear();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retry = Math.max(1, Math.ceil((windowMs - (now - bucket.start)) / 1000));
    throw new Error(`Muitas tentativas. Espere ${retry}s.`);
  }
}
