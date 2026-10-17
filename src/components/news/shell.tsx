import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { EMPTY_FEED } from "@/lib/news/types";

const LINKS = [
  { to: "/", label: "Capa" },
  { to: "/buscar", label: "Busca" },
  { to: "/acontecimentos", label: "Acontecimentos" },
  { to: "/temas", label: "Temas" },
  { to: "/admin", label: "Redação" },
  { to: "/sobre", label: "Método" },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [q, setQ] = useState("");
  const [live, setLive] = useState("");

  useEffect(() => {
    let source: EventSource | null = null;
    let debounce = 0;
    const connect = () => {
      source = new EventSource("/api/v1/stream");
      const bump = () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => {
          setLive("O feed recebeu atualização.");
          void router.invalidate();
        }, 600);
      };
      source.addEventListener("article.created", bump);
      source.addEventListener("article.updated", bump);
      source.addEventListener("event.updated", bump);
      source.onopen = () => setLive("");
    };
    connect();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void router.invalidate();
    }, 90_000);
    return () => {
      source?.close();
      window.clearInterval(poll);
      window.clearTimeout(debounce);
    };
  }, [router]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    void router.navigate({
      to: "/buscar",
      search: {
        q: q.trim(),
        category: "",
        source: "",
        page: 1,
        sort: q.trim() ? "relevance" : "date",
        from: "",
        to: "",
        language: "",
      },
    });
  }

  return (
    <div className="min-h-screen">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-card focus:px-3 focus:py-2">
        Ir para o conteúdo
      </a>
      <header className="bg-mast text-mast-fg">
        <div className="mx-auto flex w-full min-w-0 max-w-6xl items-end justify-between gap-4 px-4 py-4">
          <Link to="/" search={EMPTY_FEED} className="group">
            <span className="block font-serif text-3xl leading-none tracking-tight sm:text-4xl">Marcelus <span className="italic">News</span></span>
            <span className="mt-1 block text-xs uppercase tracking-widest text-mast-muted">Política e eleições</span>
          </Link>
          <p className="hidden text-right text-sm text-mast-muted sm:block">
            Trechos com crédito e link da fonte.
            <span className="mt-1 flex items-center justify-end gap-2 text-mast-fg">
              <span className="live-dot inline-block size-2 rounded-full bg-signal" aria-hidden="true" />
              Atualização ao vivo
            </span>
          </p>
        </div>
        <div className="h-1 bg-signal" />
      </header>
      <div className="border-b border-line bg-card">
        <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
          <nav className="flex w-full min-w-0 gap-1 overflow-x-auto lg:w-auto" aria-label="Seções">
            {LINKS.map((link) => {
              const active = link.to === "/" ? pathname === "/" : pathname.startsWith(link.to);
              const className = `inline-flex h-11 shrink-0 items-center px-3 text-sm ${active ? "bg-ink text-mast-fg" : "text-ink"}`;
              if (link.to === "/") {
                return (
                  <Link key={link.to} to="/" search={EMPTY_FEED} className={className}>
                    {link.label}
                  </Link>
                );
              }
              return (
                <Link key={link.to} to={link.to} className={className}>
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <form onSubmit={onSearch} className="flex min-w-0 flex-1 gap-2" role="search">
            <label className="sr-only" htmlFor="busca-global">Buscar notícias</label>
            <input
              id="busca-global"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Buscar por tema, pessoa, lugar"
              className="h-11 min-w-0 flex-1 border border-line bg-paper px-4 text-sm text-ink"
            />
            <button type="submit" className="inline-flex h-11 items-center gap-2 bg-ink px-4 text-sm text-mast-fg">
              <Search className="size-4" aria-hidden="true" />
              Buscar
            </button>
          </form>
          <div className="flex h-11 items-center">
            <SignedOut>
              <Link to="/login" className="text-sm underline-offset-4 hover:underline">Entrar</Link>
            </SignedOut>
            <SignedIn>
              <span className="max-w-40 overflow-hidden text-ink"><UserButton /></span>
            </SignedIn>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{live}</p>
      <main id="conteudo" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8">{children}</main>
      <footer className="mt-8 border-t border-line">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-8 text-sm text-muted">
          <p>Marcelus News reúne política e eleições. O texto vem do feed da fonte, com crédito e link para o original.</p>
          <p>Resumos marcados como IA usam só o material do feed. Eles não verificam se a notícia é verdadeira.</p>
        </div>
      </footer>
    </div>
  );
}

export function EditionLine() {
  const [label, setLabel] = useState("Edição de hoje");
  useEffect(() => {
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
    setLabel(formatted);
  }, []);
  return <p className="text-sm capitalize text-muted">{label}</p>;
}

export function LocalTime({ iso, prefix }: { iso: string | null; prefix?: string }) {
  const [label, setLabel] = useState(iso ? utcLabel(iso) : "sem data");
  useEffect(() => {
    if (!iso) return;
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
    setLabel(formatted);
  }, [iso]);
  if (!iso) return <span>{prefix}sem data de publicação</span>;
  return (
    <time dateTime={iso}>
      {prefix}
      {label}
    </time>
  );
}

function utcLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]} ${match[4]}:${match[5]} UTC`;
}

export function explainError(error: unknown): string {
  if (!(error instanceof Error)) return "Não foi possível concluir.";
  if (error.message === "Unauthorized") return "Entre para continuar.";
  return error.message;
}
