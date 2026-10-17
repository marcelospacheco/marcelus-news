import { createFileRoute } from "@tanstack/react-router";
import { listenerCount, subscribe } from "@/lib/news/bus";
import { parseFeedSearch } from "@/lib/news/types";

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => dispatch(request, params._splat ?? "", "GET"),
      POST: ({ request, params }) => dispatch(request, params._splat ?? "", "POST"),
      PATCH: ({ request, params }) => dispatch(request, params._splat ?? "", "PATCH"),
    },
  },
});

async function dispatch(request: Request, splat: string, method: string): Promise<Response> {
  const parts = splat.split("/").filter(Boolean);
  const url = new URL(request.url);
  try {
    if (method === "GET" && (parts.length === 0 || parts[0] === "health")) {
      const { getHealth } = await import("@/lib/news/queries.server");
      return json(await getHealth());
    }
    if (method === "GET" && parts[0] === "openapi") return json(openApi());
    if (method === "GET" && parts[0] === "articles" && parts.length === 1) {
      const { getFeed } = await import("@/lib/news/queries.server");
      return json(await getFeed(searchFrom(url)));
    }
    if (method === "GET" && parts[0] === "articles" && parts[1] && parts.length === 2) {
      const { getArticle } = await import("@/lib/news/queries.server");
      const article = await getArticle(parts[1]);
      return article ? json(article) : json({ error: "Não encontrado." }, 404);
    }
    if (method === "POST" && parts[0] === "articles" && parts[2] === "analyze") {
      const userId = await requireUser(request);
      const { analyzeArticle } = await import("@/lib/news/ai.server");
      return json(await analyzeArticle(userId, parts[1] ?? "", false));
    }
    if (method === "GET" && parts[0] === "search") {
      const { getFeed } = await import("@/lib/news/queries.server");
      return json(await getFeed(searchFrom(url)));
    }
    if (method === "GET" && parts[0] === "sources" && parts.length === 1) {
      const { listSourceBoard } = await import("@/lib/news/queries.server");
      return json(await listSourceBoard());
    }
    if (method === "POST" && parts[0] === "sources" && parts.length === 1) {
      const userId = await requireUser(request);
      const body = await readJson(request);
      const { createSource } = await import("@/lib/news/queries.server");
      return json(await createSource(userId, {
        name: requiredString(body, "name"),
        feedUrl: requiredString(body, "feedUrl"),
        pollIntervalSeconds: typeof body.pollIntervalSeconds === "number" ? body.pollIntervalSeconds : 900,
      }), 201);
    }
    if (method === "PATCH" && parts[0] === "sources" && parts[1]) {
      const userId = await requireUser(request);
      const body = await readJson(request);
      const { patchSource } = await import("@/lib/news/queries.server");
      return json(await patchSource(userId, parts[1], {
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        name: typeof body.name === "string" ? body.name : undefined,
        pollIntervalSeconds: typeof body.pollIntervalSeconds === "number" ? body.pollIntervalSeconds : undefined,
      }));
    }
    if (method === "GET" && parts[0] === "topics") {
      const { listTopics } = await import("@/lib/news/queries.server");
      return json(await listTopics());
    }
    if (method === "POST" && parts[0] === "topics") {
      const userId = await requireUser(request);
      const body = await readJson(request);
      const { createTopic } = await import("@/lib/news/queries.server");
      return json(await createTopic(userId, {
        name: requiredString(body, "name"),
        keywords: requiredString(body, "keywords"),
        exclusions: typeof body.exclusions === "string" ? body.exclusions : "",
      }), 201);
    }
    if (method === "GET" && parts[0] === "events" && parts.length === 1) {
      const { listEvents } = await import("@/lib/news/queries.server");
      return json(await listEvents());
    }
    if (method === "GET" && parts[0] === "events" && parts[1]) {
      const { getEvent } = await import("@/lib/news/queries.server");
      const event = await getEvent(parts[1]);
      return event ? json(event) : json({ error: "Não encontrado." }, 404);
    }
    if (method === "GET" && parts[0] === "alerts") {
      const userId = await requireUser(request);
      const { getMyDesk } = await import("@/lib/news/queries.server");
      const desk = await getMyDesk(userId);
      return json(desk.alerts);
    }
    if (method === "POST" && parts[0] === "alerts") {
      const userId = await requireUser(request);
      const body = await readJson(request);
      const { createAlert } = await import("@/lib/news/queries.server");
      return json(await createAlert(userId, {
        name: requiredString(body, "name"),
        query: typeof body.query === "string" ? body.query : "",
        topicId: typeof body.topicId === "string" ? body.topicId : "",
      }), 201);
    }
    if (method === "GET" && parts[0] === "stream") return stream(request);
    if (method === "POST" && parts[0] === "ingest") {
      const { rateLimit } = await import("@/lib/news/rate");
      rateLimit("ingest:api", 1, 20_000);
      const { ensureIngest } = await import("@/lib/news/ingest.server");
      return json(await ensureIngest(true));
    }
    return json({ error: "Não encontrado." }, 404);
  } catch (error) {
    const mapped = publicError(error);
    return json({ error: mapped.message }, mapped.status);
  }
}

function stream(request: Request): Response {
  if (listenerCount() >= 40) return json({ error: "Muitas conexões ao vivo." }, 429);
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat = 0;
  let closeTimer = 0;
  const body = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 4000\n\n"));
      send("ready", { ok: true });
      unsubscribe = subscribe((event) => send(event.type, event));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000) as unknown as number;
      closeTimer = setTimeout(() => cleanup(), 90_000) as unknown as number;
      request.signal.addEventListener("abort", () => cleanup());
      function cleanup() {
        clearInterval(heartbeat);
        clearTimeout(closeTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // já fechado
        }
      }
    },
    cancel() {
      clearInterval(heartbeat);
      clearTimeout(closeTimer);
      unsubscribe();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function searchFrom(url: URL) {
  return parseFeedSearch({
    q: url.searchParams.get("q") ?? "",
    category: url.searchParams.get("category") ?? "",
    source: url.searchParams.get("source") ?? url.searchParams.get("sourceId") ?? "",
    page: url.searchParams.get("page") ?? "1",
    sort: url.searchParams.get("sort") ?? "date",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    language: url.searchParams.get("language") ?? "",
  });
}

async function requireUser(request: Request): Promise<string> {
  const header = request.headers.get("authorization");
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const { requireUserId } = await import("@/lib/auth/verify.server");
  return requireUserId(token);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 20_000) throw new Error("Corpo grande demais.");
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON inválido.");
  return parsed as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new Error("Campo obrigatório ausente.");
  return value;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function publicError(error: unknown): { status: number; message: string } {
  if (error instanceof Error && error.name === "UnauthorizedError") return { status: 401, message: "Não autorizado." };
  if (error instanceof SyntaxError) return { status: 400, message: "JSON inválido." };
  if (error instanceof Error && /Muitas tentativas|Muitas conexões/.test(error.message)) {
    return { status: 429, message: error.message };
  }
  if (error instanceof Error && /[Nn]ão|[Dd]ê |Use |Informe|Fonte|Matéria|Tema|Alerta|Limite|endereço|URL|Feed|IA|Campo|Corpo|JSON|curto/.test(error.message)) {
    return { status: 400, message: error.message };
  }
  console.log(JSON.stringify({ event: "api.error", message: error instanceof Error ? error.message : "erro" }));
  return { status: 500, message: "Erro interno." };
}

function openApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Marcelus News",
      version: "1.0.0",
      description: "Agregador de notícias. Leituras públicas. Escrita de fontes, temas e alertas exige sessão.",
    },
    paths: {
      "/api/v1/health": { get: { summary: "Saúde sem segredos" } },
      "/api/v1/articles": { get: { summary: "Lista com q, category, source, from, to, language, sort, page" } },
      "/api/v1/articles/{id}": { get: { summary: "Detalhe, resumo e relacionadas" } },
      "/api/v1/search": { get: { summary: "Mesmos filtros de articles" } },
      "/api/v1/sources": { get: { summary: "Fontes e estado" }, post: { summary: "Cria fonte RSS. Autenticado." } },
      "/api/v1/sources/{id}": { patch: { summary: "Liga, desliga ou renomeia. Autenticado." } },
      "/api/v1/topics": { get: { summary: "Temas editoriais" }, post: { summary: "Tema do usuário. Autenticado." } },
      "/api/v1/events": { get: { summary: "Acontecimentos com 2 ou mais matérias" } },
      "/api/v1/events/{id}": { get: { summary: "Matérias do acontecimento" } },
      "/api/v1/alerts": { get: { summary: "Alertas do usuário" }, post: { summary: "Cria alerta. Autenticado." } },
      "/api/v1/stream": { get: { summary: "SSE: article.created, article.updated, event.updated" } },
      "/api/v1/ingest": { post: { summary: "Coleta as fontes vencidas ou todas, com limite de ritmo" } },
    },
  };
}
