import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { parseFeedSearch } from "./types";

function feedInput(input: unknown) {
  if (!input || typeof input !== "object") return parseFeedSearch({});
  return parseFeedSearch(input as Record<string, unknown>);
}

function idInput(input: unknown): string {
  if (!input || typeof input !== "object" || !("id" in input) || typeof input.id !== "string") {
    throw new Error("Identificador inválido.");
  }
  return input.id;
}

export const getFeed = createServerFn({ method: "GET" })
  .validator(feedInput)
  .handler(async ({ data }) => {
    const { getFeed: load } = await import("./queries.server");
    return load(data);
  });

export const getArticle = createServerFn({ method: "GET" })
  .validator(idInput)
  .handler(async ({ data }) => {
    const { getArticle: load } = await import("./queries.server");
    return load(data);
  });

export const getEvents = createServerFn({ method: "GET" }).handler(async () => {
  const { listEvents } = await import("./queries.server");
  return listEvents();
});

export const getEvent = createServerFn({ method: "GET" })
  .validator(idInput)
  .handler(async ({ data }) => {
    const { getEvent: load } = await import("./queries.server");
    return load(data);
  });

export const getTopics = createServerFn({ method: "GET" }).handler(async () => {
  const { listTopics } = await import("./queries.server");
  return listTopics();
});

export const getSourceBoard = createServerFn({ method: "GET" }).handler(async () => {
  const { listSourceBoard } = await import("./queries.server");
  return listSourceBoard();
});

export const refreshNews = createServerFn({ method: "POST" }).handler(async () => {
  const { rateLimit } = await import("./rate");
  rateLimit("ingest:public", 1, 20_000);
  const { ensureIngest } = await import("./ingest.server");
  return ensureIngest(true);
});

export const getAdminDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { getAdminDesk: load } = await import("./queries.server");
    return load();
  });

export const getMyDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getMyDesk: load } = await import("./queries.server");
    return load(context.userId);
  });

export const createSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      name: stringField(data.name),
      feedUrl: stringField(data.feedUrl),
      pollIntervalSeconds: typeof data.pollIntervalSeconds === "number" ? data.pollIntervalSeconds : 900,
    };
  })
  .handler(async ({ data, context }) => {
    const { createSource: save } = await import("./queries.server");
    return save(context.userId, data);
  });

export const patchSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      id: stringField(data.id),
      enabled: typeof data.enabled === "boolean" ? data.enabled : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
      pollIntervalSeconds: typeof data.pollIntervalSeconds === "number" ? data.pollIntervalSeconds : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const { patchSource: save } = await import("./queries.server");
    return save(context.userId, data.id, data);
  });

export const createTopic = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      name: stringField(data.name),
      keywords: stringField(data.keywords),
      exclusions: typeof data.exclusions === "string" ? data.exclusions : "",
    };
  })
  .handler(async ({ data, context }) => {
    const { createTopic: save } = await import("./queries.server");
    return save(context.userId, data);
  });

export const createAlert = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      name: stringField(data.name),
      query: typeof data.query === "string" ? data.query : "",
      topicId: typeof data.topicId === "string" ? data.topicId : "",
    };
  })
  .handler(async ({ data, context }) => {
    const { createAlert: save } = await import("./queries.server");
    return save(context.userId, data);
  });

export const setAlertEnabled = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    if (typeof data.enabled !== "boolean") throw new Error("Estado inválido.");
    return { id: stringField(data.id), enabled: data.enabled };
  })
  .handler(async ({ data, context }) => {
    const { setAlertEnabled: save } = await import("./queries.server");
    return save(context.userId, data.id, data.enabled);
  });

export const saveSearch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      name: typeof data.name === "string" ? data.name : "",
      query: typeof data.query === "string" ? data.query : "",
      filters: feedInput(data.filters),
    };
  })
  .handler(async ({ data, context }) => {
    const { saveSearch: save } = await import("./queries.server");
    return save(context.userId, data);
  });

export const deleteSavedSearch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: idInput(input) }))
  .handler(async ({ data, context }) => {
    const { deleteSavedSearch: remove } = await import("./queries.server");
    return remove(context.userId, data.id);
  });

export const analyzeArticle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return { id: stringField(data.id), force: data.force === true };
  })
  .handler(async ({ data, context }) => {
    const { analyzeArticle: run } = await import("./ai.server");
    return run(context.userId, data.id, data.force);
  });

export const summarizeEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: idInput(input) }))
  .handler(async ({ data, context }) => {
    const { summarizeEvent: run } = await import("./ai.server");
    return run(context.userId, data.id);
  });

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("Dados inválidos.");
  return input as Record<string, unknown>;
}

function stringField(value: unknown): string {
  if (typeof value !== "string") throw new Error("Campo obrigatório ausente.");
  return value;
}
