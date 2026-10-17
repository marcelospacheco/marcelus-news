import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { explainError, LocalTime } from "@/components/news/shell";
import { StoryRow } from "@/components/news/stories";
import { SignInGate } from "@/lib/auth/gates";
import { getEvent, summarizeEvent } from "@/lib/news/api";

export const Route = createFileRoute("/acontecimentos/$id")({
  loader: ({ params }) => getEvent({ data: { id: params.id } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.title} — Marcelus News` : "Acontecimento — Marcelus News" }],
  }),
  component: EventPage,
});

function EventPage() {
  const initial = Route.useLoaderData();
  const { id } = Route.useParams();
  const [override, setOverride] = useState<{ id: string; event: typeof initial } | null>(null);
  const event = override?.id === id ? override.event : initial;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!event) {
    return (
      <div>
        <h1 className="font-serif text-4xl">Acontecimento não encontrado</h1>
        <Link to="/acontecimentos" className="mt-4 inline-flex h-11 items-center text-accent">Ver a lista</Link>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-accent">Acontecimento</p>
      <h1 className="mt-2 max-w-4xl font-serif text-4xl">{event.title}</h1>
      <p className="mt-2 text-sm text-muted">
        {event.articles.length} matérias · {event.sources.join(", ") || "fontes"}
        {event.startedAt ? <> · <LocalTime iso={event.startedAt} prefix="a partir de " /></> : null}
      </p>
      <div className="mt-6 max-w-3xl border border-line bg-card p-4">
        {event.summary ? (
          <>
            <p className="text-xs uppercase tracking-widest text-accent">
              {event.summaryProvider === "xai" ? "Resumo consolidado por IA" : "Resumo"}
            </p>
            <p className="mt-2">{event.summary}</p>
          </>
        ) : (
          <p className="text-sm text-muted">Não há um resumo único. Leia as matérias abaixo lado a lado.</p>
        )}
        <p className="mt-3 text-sm text-muted">
          {event.lowOverlap
            ? "Os trechos disponíveis divergem bastante. Isso pode ser ângulo diferente, atualização ou outro fato parecido."
            : "As fontes podem divergir em detalhe. O título de cada uma está preservado."}
        </p>
        <SignInGate fallback={<p className="mt-3 text-sm">Entre para pedir um resumo consolidado.</p>}>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setNote(null);
              void summarizeEvent({ data: { id } })
                .then(() => getEvent({ data: { id } }))
                .then((next) => {
                  setOverride({ id, event: next });
                  setNote("Resumo consolidado pronto.");
                })
                .catch((error: unknown) => setNote(explainError(error)))
                .finally(() => setBusy(false));
            }}
            className="mt-4 h-11 bg-accent px-4 text-sm text-accent-fg disabled:opacity-60"
          >
            {busy ? "Resumindo…" : "Resumir acontecimento com IA"}
          </button>
        </SignInGate>
        {note ? <p className="mt-3 text-sm">{note}</p> : null}
      </div>
      <h2 className="mt-10 font-serif text-3xl">Linha do tempo</h2>
      <ol className="mt-4 border-l border-line pl-4">
        {event.articles.map((article) => (
          <li key={article.id} className="pb-2">
            <p className="text-sm text-muted"><LocalTime iso={article.publishedAt ?? article.discoveredAt} /></p>
            <ul><StoryRow article={article} /></ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
