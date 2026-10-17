export type PulseEvent =
  | { type: "article.created"; id: string; title: string; sourceId: string }
  | { type: "article.updated"; id: string }
  | { type: "event.updated"; id: string; articleCount: number };

type Listener = (event: PulseEvent) => void;

const globalRef = globalThis as typeof globalThis & { __pulsoListeners?: Set<Listener> };

function listeners(): Set<Listener> {
  globalRef.__pulsoListeners ??= new Set();
  return globalRef.__pulsoListeners;
}

export function listenerCount(): number {
  return listeners().size;
}

export function publish(event: PulseEvent): void {
  for (const listener of listeners()) {
    try {
      listener(event);
    } catch {
      // Um cliente lento não pode derrubar a coleta.
    }
  }
}

export function subscribe(listener: Listener): () => void {
  const bucket = listeners();
  bucket.add(listener);
  return () => bucket.delete(listener);
}
