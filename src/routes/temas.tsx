import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { explainError } from "@/components/news/shell";
import { SignInGate } from "@/lib/auth/gates";
import { createAlert, createTopic, getMyDesk, getTopics, setAlertEnabled } from "@/lib/news/api";

export const Route = createFileRoute("/temas")({
  loader: () => getTopics(),
  head: () => ({ meta: [{ title: "Temas — Marcelus News" }] }),
  component: TopicsPage,
});

type Desk = Awaited<ReturnType<typeof getMyDesk>>;

function TopicsPage() {
  const topics = Route.useLoaderData();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function reload() {
    return getMyDesk().then(setDesk).catch(() => setDesk(null));
  }

  useEffect(() => {
    let cancelled = false;
    getMyDesk()
      .then((value) => {
        if (!cancelled) setDesk(value);
      })
      .catch(() => {
        if (!cancelled) setDesk(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-accent">Temas</p>
      <h1 className="mt-1 font-serif text-4xl">Assuntos acompanhados</h1>
      <p className="mt-3 max-w-2xl text-muted">Os temas ligam matérias de política por palavras do título e do texto. Alertas avisam dentro da Marcelus News, não por e-mail.</p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {topics.map((topic) => (
          <li key={topic.id} className="border border-line bg-card p-4">
            <h2 className="font-serif text-2xl">{topic.name}</h2>
            <p className="mt-1 text-sm text-muted">{topic.articleCount} matérias ligadas</p>
            <p className="mt-2 text-sm">{topic.keywords.join(", ")}</p>
            <Link to="/buscar" search={{ q: topic.keywords[0] ?? topic.name, category: "", source: "", page: 1, sort: "date", from: "", to: "", language: "" }} className="mt-3 inline-flex h-11 items-center text-sm text-accent">
              Ver na busca
            </Link>
          </li>
        ))}
      </ul>
      <section className="mt-10">
        <h2 className="font-serif text-3xl">Seus alertas</h2>
        <SignInGate fallback={<p className="mt-3 text-muted">Entre para criar temas e alertas só seus.</p>}>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <form
              className="space-y-3 border border-line bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void createTopic({
                  data: {
                    name: String(form.get("name") ?? ""),
                    keywords: String(form.get("keywords") ?? ""),
                    exclusions: String(form.get("exclusions") ?? ""),
                  },
                })
                  .then(() => {
                    setNote("Tema criado. Ele passa a valer nas próximas coletas.");
                    event.currentTarget.reset();
                    return reload();
                  })
                  .catch((error: unknown) => setNote(explainError(error)));
              }}
            >
              <h3 className="font-serif text-2xl">Novo tema</h3>
              <Field name="name" label="Nome" />
              <Field name="keywords" label="Palavras-chave, separadas por vírgula" />
              <Field name="exclusions" label="Exclusões" />
              <button type="submit" className="h-11 bg-ink px-4 text-sm text-mast-fg">Criar tema</button>
            </form>
            <form
              className="space-y-3 border border-line bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void createAlert({
                  data: {
                    name: String(form.get("name") ?? ""),
                    query: String(form.get("query") ?? ""),
                    topicId: String(form.get("topicId") ?? ""),
                  },
                })
                  .then(() => {
                    setNote("Alerta ativo. Novas matérias compatíveis aparecem abaixo.");
                    event.currentTarget.reset();
                    return reload();
                  })
                  .catch((error: unknown) => setNote(explainError(error)));
              }}
            >
              <h3 className="font-serif text-2xl">Novo alerta</h3>
              <Field name="name" label="Nome do alerta" />
              <Field name="query" label="Todas estas palavras no texto" />
              <label className="block text-sm">Tema
                <select name="topicId" className="mt-1 h-11 w-full border border-line bg-paper px-3">
                  <option value="">Nenhum</option>
                  {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
                  {desk?.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
                </select>
              </label>
              <button type="submit" className="h-11 bg-accent px-4 text-sm text-accent-fg">Criar alerta</button>
            </form>
          </div>
          {desk ? (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="font-serif text-2xl">Alertas</h3>
                <ul className="mt-2 divide-y divide-line">
                  {desk.alerts.map((alert) => (
                    <li key={alert.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span>{alert.name}{alert.query ? ` · ${alert.query}` : ""}</span>
                      <button type="button" className="h-11 px-2 underline-offset-4 hover:underline" onClick={() => void setAlertEnabled({ data: { id: alert.id, enabled: !alert.enabled } }).then(reload)}>
                        {alert.enabled ? "Desativar" : "Ativar"}
                      </button>
                    </li>
                  ))}
                  {desk.alerts.length === 0 ? <li className="py-3 text-sm text-muted">Nenhum alerta ainda.</li> : null}
                </ul>
              </div>
              <div>
                <h3 className="font-serif text-2xl">Disparos recentes</h3>
                <ul className="mt-2 divide-y divide-line">
                  {desk.hits.map((hit) => (
                    <li key={`${hit.articleId}-${hit.createdAt}`} className="py-3 text-sm">
                      <Link to="/artigo/$id" params={{ id: hit.articleId }} className="hover:text-accent">{hit.title}</Link>
                      <p className="text-muted">{hit.alertName}</p>
                    </li>
                  ))}
                  {desk.hits.length === 0 ? <li className="py-3 text-sm text-muted">Nenhum disparo ainda.</li> : null}
                </ul>
              </div>
            </div>
          ) : null}
        </SignInGate>
        {note ? <p className="mt-4 text-sm">{note}</p> : null}
      </section>
    </div>
  );
}

function Field({ name, label }: { name: string; label: string }) {
  return (
    <label className="block text-sm">{label}
      <input name={name} className="mt-1 h-11 w-full border border-line bg-paper px-3" />
    </label>
  );
}
