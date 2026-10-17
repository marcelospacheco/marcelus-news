import { createFileRoute, Navigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { EMPTY_FEED } from "@/lib/news/types";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar — Marcelus News" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <p className="text-muted">Conferindo a sessão…</p>;
  if (user) return <Navigate to="/" search={EMPTY_FEED} />;
  return (
    <div className="mx-auto max-w-md">
      <p className="text-xs uppercase tracking-widest text-accent">Conta</p>
      <h1 className="mt-1 font-serif text-4xl">Entrar</h1>
      <p className="mt-3 text-muted">A capa é aberta. A conta serve para fontes, alertas, pesquisas salvas e resumos de IA.</p>
      <div className="mt-6 flex flex-col gap-3">
        {GROK_PROVIDERS.map((provider) => (
          <button
            key={provider.providerId}
            type="button"
            onClick={() => void signIn(provider.providerId, { callbackURL: "/" })}
            className="h-11 border border-line bg-card px-4 text-sm"
          >
            Continuar com {provider.label}
          </button>
        ))}
      </div>
    </div>
  );
}
