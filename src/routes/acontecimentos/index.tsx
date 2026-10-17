import { createFileRoute, Link } from "@tanstack/react-router";
import { LocalTime } from "@/components/news/shell";
import { getEvents } from "@/lib/news/api";

export const Route = createFileRoute("/acontecimentos/")({
  loader: () => getEvents(),
  head: () => ({ meta: [{ title: "Acontecimentos — Marcelus News" }] }),
  component: EventsPage,
});

function EventsPage() {
  const events = Route.useLoaderData();
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-accent">Acontecimentos</p>
      <h1 className="mt-1 max-w-3xl font-serif text-4xl">Matérias que parecem falar do mesmo fato</h1>
      <p className="mt-3 max-w-2xl text-muted">
        O agrupamento compara títulos, links e horário. Ele não apaga coberturas parecidas: cada fonte continua na própria matéria.
      </p>
      {events.length === 0 ? (
        <p className="mt-8 font-serif text-2xl">Ainda não há grupos com duas ou mais matérias.</p>
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {events.map((event) => (
            <li key={event.id} className="py-5">
              <Link to="/acontecimentos/$id" params={{ id: event.id }} className="block hover:text-accent">
                <p className="text-xs uppercase tracking-widest text-muted">
                  {event.articleCount} matérias · {event.sourceCount} {event.sourceCount === 1 ? "fonte" : "fontes"}
                  {event.summaryProvider === "xai" ? " · resumo de IA" : ""}
                </p>
                <h2 className="mt-1 font-serif text-2xl">{event.title}</h2>
                <p className="mt-1 text-sm text-muted"><LocalTime iso={event.updatedAt} prefix="Atualizado em " /></p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
