import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { explainError } from "@/components/news/shell";
import { StoryRow } from "@/components/news/stories";
import { SignInGate } from "@/lib/auth/gates";
import { deleteSavedSearch, getFeed, getMyDesk, saveSearch } from "@/lib/news/api";
import { PAGE_SIZE, parseFeedSearch, type FeedSearch } from "@/lib/news/types";

export const Route = createFileRoute("/buscar")({
  validateSearch: (search) => parseFeedSearch(search as Record<string, unknown>),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getFeed({ data: deps }),
  head: () => ({ meta: [{ title: "Busca — Marcelus News" }] }),
  component: SearchPage,
});

function SearchPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/buscar" });
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string; query: string; filters: unknown }[]>([]);
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  useEffect(() => {
    let cancelled = false;
    getMyDesk()
      .then((desk) => {
        if (!cancelled) setSaved(desk.searches);
      })
      .catch(() => {
        if (!cancelled) setSaved([]);
      });
    return () => {
      cancelled = true;
    };
  }, [note]);

  function update(patch: Partial<FeedSearch>) {
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }) });
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-accent">Busca</p>
      <h1 className="mt-1 font-serif text-4xl">Encontre uma cobertura</h1>
      <form
        className="mt-6 grid gap-3 border border-line bg-card p-4 sm:grid-cols-2"
        key={`${search.q}|${search.source}|${search.category}|${search.from}|${search.to}|${search.language}|${search.sort}`}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          update({
            q: String(form.get("q") ?? ""),
            source: String(form.get("source") ?? ""),
            category: String(form.get("category") ?? ""),
            from: String(form.get("from") ?? ""),
            to: String(form.get("to") ?? ""),
            language: String(form.get("language") ?? ""),
            sort: String(form.get("sort") ?? "date") === "relevance" ? "relevance" : "date",
          });
        }}
      >
        <label className="text-sm sm:col-span-2">Termos
          <input name="q" defaultValue={search.q} className="mt-1 h-11 w-full border border-line bg-paper px-3" />
        </label>
        <label className="text-sm">Fonte
          <select name="source" defaultValue={search.source} className="mt-1 h-11 w-full border border-line bg-paper px-3">
            <option value="">Todas</option>
            {data.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Categoria
          <select name="category" defaultValue={search.category} className="mt-1 h-11 w-full border border-line bg-paper px-3">
            <option value="">Todas</option>
            {data.categories.map((item) => <option key={item.category} value={item.category}>{item.category}</option>)}
          </select>
        </label>
        <label className="text-sm">De
          <input type="date" name="from" defaultValue={search.from} className="mt-1 h-11 w-full border border-line bg-paper px-3" />
        </label>
        <label className="text-sm">Até
          <input type="date" name="to" defaultValue={search.to} className="mt-1 h-11 w-full border border-line bg-paper px-3" />
        </label>
        <label className="text-sm">Idioma
          <select name="language" defaultValue={search.language} className="mt-1 h-11 w-full border border-line bg-paper px-3">
            <option value="">Todos</option>
            <option value="pt">Português</option>
            <option value="en">Inglês</option>
          </select>
        </label>
        <label className="text-sm">Ordem
          <select name="sort" defaultValue={search.sort} className="mt-1 h-11 w-full border border-line bg-paper px-3">
            <option value="date">Data</option>
            <option value="relevance">Relevância</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="h-11 bg-ink px-4 text-sm text-mast-fg">Aplicar filtros</button>
        </div>
      </form>
      <div className="mt-4">
        <SignInGate fallback={<p className="text-sm text-muted">Entre para guardar esta pesquisa.</p>}>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSearch({ data: { name, query: search.q, filters: search } })
                .then(() => {
                  setName("");
                  setNote("Pesquisa salva.");
                })
                .catch((error: unknown) => setNote(explainError(error)));
            }}
          >
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da pesquisa" className="h-11 min-w-0 flex-1 border border-line bg-card px-3" />
            <button type="submit" className="h-11 border border-line px-4 text-sm">Salvar pesquisa</button>
          </form>
          {saved.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {saved.map((item) => (
                <li key={item.id} className="flex items-center gap-2 border border-line bg-card px-3 py-2 text-sm">
                  <button
                    type="button"
                    className="underline-offset-4 hover:underline"
                    onClick={() => {
                      const filters = item.filters && typeof item.filters === "object" ? item.filters as FeedSearch : search;
                      void navigate({ search: { ...parseFeedSearch(filters as unknown as Record<string, unknown>), q: item.query } });
                    }}
                  >
                    {item.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Apagar ${item.name}`}
                    onClick={() => {
                      void deleteSavedSearch({ data: { id: item.id } }).then(() => setNote("Pesquisa removida."));
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </SignInGate>
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      </div>
      <p className="mt-6 text-sm text-muted">{data.total} resultados</p>
      {data.articles.length === 0 ? (
        <p className="mt-6 font-serif text-2xl">Nada encontrado com esses filtros.</p>
      ) : (
        <ul>{data.articles.map((article) => <StoryRow key={article.id} article={article} />)}</ul>
      )}
      <div className="mt-6 flex gap-2">
        <button type="button" disabled={search.page <= 1} onClick={() => update({ page: search.page - 1 })} className="h-11 border border-line px-4 text-sm disabled:opacity-40">Anterior</button>
        <span className="inline-flex h-11 items-center text-sm tabular-nums">Página {search.page} de {pages}</span>
        <button type="button" disabled={search.page >= pages} onClick={() => update({ page: search.page + 1 })} className="h-11 border border-line px-4 text-sm disabled:opacity-40">Próxima</button>
      </div>
    </div>
  );
}
