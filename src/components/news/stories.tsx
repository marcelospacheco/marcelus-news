import { Link } from "@tanstack/react-router";
import { ExternalLink, Sparkles } from "lucide-react";
import type { ArticleCard } from "@/lib/news/types";
import { LocalTime } from "./shell";

export function LeadStory({ article }: { article: ArticleCard }) {
  return (
    <article className="border-b border-line pb-8">
      <Kicker article={article} />
      <h2 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">
        <Link to="/artigo/$id" params={{ id: article.id }} className="hover:text-accent">
          {article.title}
        </Link>
      </h2>
      {article.excerpt ? <p className="mt-4 max-w-3xl text-lg text-muted">{article.excerpt}</p> : null}
      <Summary article={article} />
      <SourceLink url={article.url} />
    </article>
  );
}

export function StoryRow({ article }: { article: ArticleCard }) {
  return (
    <li className="border-b border-line py-5">
      <article className="grid gap-4 sm:grid-cols-[1fr_9rem] sm:items-start">
        <div>
          <Kicker article={article} />
          <h3 className="mt-1 font-serif text-2xl leading-snug">
            <Link to="/artigo/$id" params={{ id: article.id }} className="hover:text-accent">
              {article.title}
            </Link>
          </h3>
          {article.excerpt ? <p className="mt-2 line-clamp-3 text-sm text-muted">{article.excerpt}</p> : null}
          <Summary article={article} />
        </div>
      </article>
    </li>
  );
}

function Kicker({ article }: { article: ArticleCard }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-widest">
      <span className="text-accent">{article.sourceName}</span>
      {article.category ? (
        <span className="text-muted">
          {article.modelProvider === "rules" ? "Categoria estimada · " : ""}
          {article.category}
        </span>
      ) : null}
      <LocalTime iso={article.publishedAt ?? article.discoveredAt} />
      {article.eventId ? (
        <Link to="/acontecimentos/$id" params={{ id: article.eventId }} className="normal-case tracking-normal text-ink underline-offset-4 hover:underline">
          Mesmo acontecimento
        </Link>
      ) : null}
    </p>
  );
}

function Summary({ article }: { article: ArticleCard }) {
  if (!article.summary || article.modelProvider !== "xai") return null;
  return (
    <p className="mt-3 border-l-2 border-accent pl-3 text-sm">
      <span className="mb-1 flex items-center gap-1 text-xs uppercase tracking-widest text-accent">
        <Sparkles className="size-3" aria-hidden="true" />
        Resumo gerado por IA
      </span>
      {article.summary}
    </p>
  );
}

function SourceLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex h-11 items-center gap-2 text-sm text-accent">
      Ler na fonte
      <ExternalLink className="size-4" aria-hidden="true" />
    </a>
  );
}

export { SourceLink };
