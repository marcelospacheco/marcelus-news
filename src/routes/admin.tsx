import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { explainError, LocalTime } from "@/components/news/shell";
import { SignInGate } from "@/lib/auth/gates";
import { createSource, getAdminDesk, getSourceBoard, patchSource, refreshNews } from "@/lib/news/api";

export const Route = createFileRoute("/admin")({
  loader: () => getSourceBoard(),
  head: () => ({ meta: [{ title: "Redação — Marcelus News" }] }),
  component: AdminPage,
});

type Desk = Awaited<ReturnType<typeof getAdminDesk>>;
const STATUS: Record<string, string> = {
  ok: "em dia",
  late: "atrasada",
  error: "falha",
  pending: "credencial pendente",
  off: "desligada",
};

function AdminPage() {
  const board = Route.useLoaderData();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function reload() {
    return getAdminDesk().then(setDesk).catch(() => setDesk(null));
  }

  useEffect(() => {
    let cancelled = false;
    getAdminDesk()
      .then((value) => {
        if (!cancelled) setDesk(value);
      })
      .catch(() => {
        if (!cancelled) setDesk(null);
      });
    return () => {
      cancelled = true;
    };
  }, [note]);

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-accent">Redação</p>
      <h1 className="mt-1 font-serif text-4xl">Fontes e coleta</h1>
      <p className="mt-3 max-w-2xl text-muted">YouTube e X ficam desligados até existir credencial oficial. Nada é simulado no lugar de uma publicação real.</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {(desk?.sources ?? board.map((item) => ({ ...item, feedUrl: null, lastErrorMessage: null, pollIntervalSeconds: 0 }))).map((source) => (
          <li key={source.id} className="border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-2xl">{source.name}</h2>
                <p className="text-xs uppercase tracking-widest text-muted">{source.type} · {STATUS[source.status] ?? source.status}</p>
              </div>
              <SignInGate fallback={null}>
                {"enabled" in source ? (
                  <button
                    type="button"
                    className="h-11 shrink-0 border border-line px-3 text-sm"
                    onClick={() => {
                      void patchSource({ data: { id: source.id, enabled: !source.enabled } })
                        .then(() => setNote(source.enabled ? "Fonte desligada." : "Fonte ligada. A próxima coleta entra no ritmo."))
                        .catch((error: unknown) => setNote(explainError(error)));
                    }}
                  >
                    {source.enabled ? "Desligar" : "Ligar"}
                  </button>
                ) : null}
              </SignInGate>
            </div>
            {source.lastSuccessAt ? <p className="mt-2 text-sm text-muted"><LocalTime iso={source.lastSuccessAt} prefix="Última coleta boa em " /></p> : null}
            {source.lastErrorMessage ? <p className="mt-2 text-sm text-accent">{source.lastErrorMessage}</p> : null}
          </li>
        ))}
      </ul>
      <SignInGate fallback={<p className="mt-8 text-muted">Entre para cadastrar uma fonte RSS, ver o erro completo e o uso de IA.</p>}>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <form
            className="space-y-3 border border-line bg-card p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const minutes = Number(form.get("minutes") ?? 15);
              void createSource({
                data: {
                  name: String(form.get("name") ?? ""),
                  feedUrl: String(form.get("feedUrl") ?? ""),
                  pollIntervalSeconds: minutes * 60,
                },
              })
                .then(() => {
                  setNote("Fonte adicionada. Use atualizar na capa para coletá-la agora.");
                  event.currentTarget.reset();
                })
                .catch((error: unknown) => setNote(explainError(error)));
            }}
          >
            <h2 className="font-serif text-2xl">Nova fonte RSS</h2>
            <label className="block text-sm">Nome
              <input name="name" required className="mt-1 h-11 w-full border border-line bg-paper px-3" />
            </label>
            <label className="block text-sm">URL https do feed
              <input name="feedUrl" required type="url" placeholder="https://" className="mt-1 h-11 w-full border border-line bg-paper px-3" />
            </label>
            <label className="block text-sm">Intervalo
              <select name="minutes" defaultValue="15" className="mt-1 h-11 w-full border border-line bg-paper px-3">
                <option value="15">15 minutos</option>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
              </select>
            </label>
            <button type="submit" className="h-11 bg-ink px-4 text-sm text-mast-fg">Validar e salvar</button>
          </form>
          <div className="border border-line bg-card p-4">
            <h2 className="font-serif text-2xl">Uso de IA</h2>
            {desk ? (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt>Matérias no acervo</dt><dd className="tabular-nums">{desk.metrics.articles}</dd></div>
                <div className="flex justify-between gap-3"><dt>Novas em 24 h</dt><dd className="tabular-nums">{desk.metrics.new_24h}</dd></div>
                <div className="flex justify-between gap-3"><dt>Falhas de coleta em 24 h</dt><dd className="tabular-nums">{desk.metrics.errors_24h}</dd></div>
                <div className="flex justify-between gap-3"><dt>Análises de IA</dt><dd className="tabular-nums">{desk.metrics.ai_calls}</dd></div>
                <div className="flex justify-between gap-3"><dt>Tokens registrados</dt><dd className="tabular-nums">{desk.metrics.ai_tokens}</dd></div>
                <div className="flex justify-between gap-3"><dt>IA neste ambiente</dt><dd>{desk.ai === "available" ? "disponível" : "indisponível"}</dd></div>
              </dl>
            ) : <p className="mt-3 text-sm text-muted">Carregando métricas…</p>}
            <p className="mt-3 text-sm text-muted">A cobrança real fica na conta da xAI. Aqui só entram tokens de chamadas feitas por um clique.</p>
            <button
              type="button"
              className="mt-4 h-11 border border-line px-4 text-sm"
              onClick={() => {
                void refreshNews()
                  .then((report) => setNote(`Coleta manual: ${report.itemsNew} novas, ${report.errors} fontes com erro.`))
                  .catch((error: unknown) => setNote(explainError(error)));
              }}
            >
              Coletar agora
            </button>
          </div>
        </div>
        {desk ? (
          <div className="mt-6 overflow-x-auto">
            <h2 className="font-serif text-2xl">Últimas coletas</h2>
            <table className="mt-3 w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Quando</th>
                  <th className="py-2 pr-3 font-medium">Fonte</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 pr-3 font-medium">Novas</th>
                  <th className="py-2 font-medium">Nota</th>
                </tr>
              </thead>
              <tbody>
                {desk.runs.map((run) => (
                  <tr key={run.id} className="border-t border-line">
                    <td className="py-2 pr-3"><LocalTime iso={run.startedAt} /></td>
                    <td className="py-2 pr-3">{run.sourceId}</td>
                    <td className="py-2 pr-3">{run.status === "success" ? "ok" : "erro"}</td>
                    <td className="py-2 pr-3 tabular-nums">{run.itemsNew}/{run.itemsFound}</td>
                    <td className="py-2">{run.errorMessage ?? `${run.itemsDuplicate} já vistas`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </SignInGate>
      {note ? <p className="mt-4 text-sm">{note}</p> : null}
    </div>
  );
}
