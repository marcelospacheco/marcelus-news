import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, Sparkles } from "lucide-react";
import { useState } from "react";
import { explainError, LocalTime } from "@/components/news/shell";
import { StoryRow } from "@/components/news/stories";
import { SignInGate } from "@/lib/auth/gates";
import { analyzeArticle, getArticle } from "@/lib/news/api";
import { EMPTY_FEED } from "@/lib/news/types";

export const Route = createFileRoute("/artigo/$id")({
  loader: ({ params }) => getArticle({ data: { id: params.id } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.title} — Marcelus News` : "Matéria — Marcelus News" }],
  }),
  component: ArticlePage,
});

function ArticlePage() {
  const initial = Route.useLoaderData();
  const { id } = Route.useParams();
  const [override, setOverride] = useState<{ id: string; article: typeof initial } | null>(null);
  const article = override?.id === id ? override.article : initial;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!article) {
    return (
      <div>
        <h1 className="font-serif text-4xl">Não encontramos essa matéria</h1>
        <Link to="/" search={EMPTY_FEED} className="mt-4 inline-flex h-11 items-center text-accent">Voltar à capa</Link>
      </div>
    );
  }

  async function run(force: boolean) {
    setBusy(true);
    setNote(null);
    try {
      await analyzeArticle({ data: { id, force } });
      const next = await getArticle({ data: { id } });
      setOverride({ id, article: next });
      setNote(force ? "Resumo refeito." : "Resumo pronto.");
    } catch (error) {
      setNote(explainError(error));
    } finally {
      setBusy(false);
    }
  }

  const ai = article.modelProvider === "xai" && article.summary;

  const paragraphs = storyParagraphs(article.body || article.excerpt);
  const shortFeed = (article.body || article.excerpt).trim().length < 500;

  return (
    <article>
      <p className="text-xs uppercase tracking-widest text-accent">{article.sourceName}</p>
      <h1 className="mt-2 max-w-4xl font-serif text-4xl leading-tight sm:text-5xl">{article.title}</h1>
      <p className="mt-3 text-sm text-muted">
        <LocalTime iso={article.publishedAt} prefix="Publicada em " />
        {" · "}
        <LocalTime iso={article.discoveredAt} prefix="descoberta em " />
        {article.category ? ` · ${article.category}` : ""}
        {article.modelProvider === "rules" ? " (categoria estimada, sem IA)" : ""}
      </p>
      <div className="mt-6 max-w-3xl space-y-4 text-lg leading-relaxed">
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <aside className="mt-8 max-w-3xl border-l-4 border-signal bg-card px-4 py-4">
        <p className="text-xs uppercase tracking-widest text-accent">Crédito</p>
        <p className="mt-2">
          Texto de {article.sourceName}. Marcelus News não é o autor: reproduz o que o veículo publicou no feed e aponta o original.
        </p>
        {shortFeed ? (
          <p className="mt-2 text-sm text-muted">O feed desta fonte trouxe só este trecho. O restante está no site do veículo.</p>
        ) : null}
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex h-11 items-center gap-2 bg-accent px-4 text-sm text-accent-fg">
          Ler na {article.sourceName}
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </aside>
      <div className="mt-6 max-w-3xl border border-line bg-card p-4">
        {ai ? (
          <>
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-accent">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Resumo gerado por IA
            </p>
            <p className="mt-2">{article.summary}</p>
            <p className="mt-3 text-sm text-muted">
              Feito a partir do título e do trecho do feed de {article.sourceName}. Não é checagem de veracidade.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Ainda não há resumo de IA. A categoria acima, quando existe, é uma estimativa por palavras-chave.</p>
        )}
        <SignInGate fallback={<p className="mt-3 text-sm">Entre para gerar o resumo com IA.</p>}>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run(Boolean(ai))} className="h-11 bg-accent px-4 text-sm text-accent-fg disabled:opacity-60">
              {busy ? "Gerando…" : ai ? "Refazer resumo" : "Gerar resumo com IA"}
            </button>
          </div>
        </SignInGate>
        {note ? <p className="mt-3 text-sm">{note}</p> : null}
        {article.entities.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {article.entities.map((entity) => (
              <li key={`${entity.type}-${entity.name}`} className="border border-line px-2 py-1 text-xs">
                {entity.name} <span className="text-muted">· {entity.type}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {article.related.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-serif text-3xl">Outras coberturas do mesmo acontecimento</h2>
          <ul>{article.related.map((item) => <StoryRow key={item.id} article={item} />)}</ul>
        </section>
      ) : null}
    </article>
  );
}

function storyParagraphs(value: string): string[] {
  const parts = value.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const source = parts.length > 1 ? parts : parts[0] ? [parts[0]] : [];
  if (source.length !== 1 || source[0].length < 500) return source;
  const sentences = source[0].split(/(?<=[.!?])\s+/);
  const groups: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
    if (buffer.length > 320) {
      groups.push(buffer);
      buffer = "";
    }
  }
  if (buffer) groups.push(buffer);
  return groups;
}
