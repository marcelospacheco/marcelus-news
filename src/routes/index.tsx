import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { EditionLine, explainError } from "@/components/news/shell";
import { LeadStory, StoryRow } from "@/components/news/stories";
import { getFeed, refreshNews } from "@/lib/news/api";
import { PAGE_SIZE, parseFeedSearch, type FeedSearch } from "@/lib/news/types";

const DESK = [
  { label: "Tudo", q: "" },
  { label: "Eleições", q: "eleicao" },
  { label: "Congresso", q: "congresso" },
  { label: "Governo", q: "governo" },
  { label: "Judiciário", q: "stf" },
] as const;

export const Route = createFileRoute("/")({
  validateSearch: (search) => parseFeedSearch(search as Record<string, unknown>),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getFeed({ data: deps }),
  pendingComponent: () => <p className="text-muted">Abrindo a edição…</p>,
  component: Home,
});

function Home() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lead = search.page === 1 && !search.q && !search.category && !search.source ? data.articles[0] : null;
  const rest = lead ? data.articles.slice(1) : data.articles;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  function update(patch: Partial<FeedSearch>) {
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }) });
  }

  async function refresh() {
    setBusy(true);
    setNote(null);
    try {
      const report = await refreshNews();
      setNote(
        report.itemsNew > 0
          ? `${report.itemsNew} ${report.itemsNew === 1 ? "notícia nova" : "notícias novas"}.`
          : "Nenhuma notícia nova nas fontes agora.",
      );
      await navigate({ search: (prev) => ({ ...prev }) });
    } catch (error) {
      setNote(explainError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-accent">Edição política</p>
          <EditionLine />
        </div>
        <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex h-11 items-center gap-2 border border-line bg-card px-4 text-sm disabled:opacity-60">
          <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
          {busy ? "Coletando…" : "Atualizar agora"}
        </button>
      </div>
      {note ? <p className="mb-4 text-sm text-muted">{note}</p> : null}
      {data.sourceProblems > 0 ? (
        <p className="mb-4 text-sm text-muted">
          {data.sourceProblems === 1 ? "Uma fonte falhou" : `${data.sourceProblems} fontes falharam`} nesta coleta. As outras seguem.
          {" "}
          <Link to="/admin" className="text-ink underline-offset-4 hover:underline">Ver redação</Link>
        </p>
      ) : null}
      <div className="mb-6 flex w-full min-w-0 gap-2 overflow-x-auto pb-1">
        {DESK.map((item) => (
          <Chip key={item.label} active={(search.q || "") === item.q && !search.category} onClick={() => update({ q: item.q, category: "" })}>
            {item.label}
          </Chip>
        ))}
      </div>
      {data.articles.length === 0 ? (
        <div className="border border-line bg-card px-5 py-10">
          <h1 className="font-serif text-3xl">Nenhuma matéria com esse recorte</h1>
          <p className="mt-2 max-w-xl text-muted">Esta edição só entra com política e eleições. A coleta continua sozinha.</p>
        </div>
      ) : (
        <>
          {lead ? <LeadStory article={lead} /> : null}
          {data.events.length > 0 ? (
            <section className="my-8" aria-label="Acontecimentos">
              <h2 className="mb-3 font-serif text-2xl">O mesmo fato, em mais de uma fonte</h2>
              <div className="flex w-full min-w-0 snap-x gap-3 overflow-x-auto pb-2">
                {data.events.map((event) => (
                  <Link
                    key={event.id}
                    to="/acontecimentos/$id"
                    params={{ id: event.id }}
                    className="w-72 shrink-0 snap-start border border-line bg-card p-4"
                  >
                    <p className="text-xs uppercase tracking-widest text-accent">
                      {event.articleCount} matérias · {event.sourceCount} {event.sourceCount === 1 ? "fonte" : "fontes"}
                    </p>
                    <p className="mt-2 font-serif text-xl leading-snug">{event.title}</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          <div className="grid gap-8 lg:grid-cols-12">
            <ul className="lg:col-span-8">
              {rest.map((article) => <StoryRow key={article.id} article={article} />)}
            </ul>
            <aside className="lg:col-span-4">
              <h2 className="font-serif text-2xl">Fontes desta edição</h2>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {data.sources.map((source) => (
                  <li key={source.id}>
                    <button type="button" onClick={() => update({ source: source.id })} className="flex h-11 w-full items-center text-left text-sm hover:text-accent">
                      {source.name}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted">{data.total} matérias no acervo visível por estes filtros.</p>
            </aside>
          </div>
          <div className="mt-6 flex gap-2">
            <button type="button" disabled={search.page <= 1} onClick={() => update({ page: search.page - 1 })} className="h-11 border border-line bg-card px-4 text-sm disabled:opacity-40">Anterior</button>
            <span className="inline-flex h-11 items-center text-sm tabular-nums">Página {search.page} de {pages}</span>
            <button type="button" disabled={search.page >= pages} onClick={() => update({ page: search.page + 1 })} className="h-11 border border-line bg-card px-4 text-sm disabled:opacity-40">Próxima</button>
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`h-11 shrink-0 px-3 text-sm ${active ? "bg-accent text-accent-fg" : "border border-line bg-card text-ink"}`}>
      {children}
    </button>
  );
}
