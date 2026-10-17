import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sobre")({
  head: () => ({ meta: [{ title: "Método — Marcelus News" }] }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <article className="max-w-3xl">
      <p className="text-xs uppercase tracking-widest text-accent">Método</p>
      <h1 className="mt-1 font-serif text-4xl">Como a Marcelus News lê as notícias</h1>
      <div className="mt-6 space-y-4 text-base">
        <p>A edição cobre só política e eleições. Entram G1 Política, Folha Poder, Poder360, Câmara, Senado, CNN Brasil, Agência Brasil e BBC News Brasil. O que não é dessa pauta fica de fora, mesmo que o feed traga outras notícias.</p>
        <p>O texto da matéria é o que o veículo publicou no próprio feed. A página dá o crédito e um link para o original. Não atravessamos paywall, login nem CAPTCHA, e não nos apresentamos como autores.</p>
        <p>Uma fonte que falha fica registrada e as outras continuam. O mesmo item, se chegar de novo, não vira outra matéria.</p>
        <p>Matérias parecidas de veículos diferentes são agrupadas, não apagadas. A busca usa título e texto, com filtros de fonte, data e idioma.</p>
        <p>O resumo de IA só nasce quando alguém pede, a partir do título e do texto do feed. Ele não verifica se a notícia é verdadeira.</p>
        <p>O feed ao vivo avisa a tela quando uma matéria nova é gravada. Se a conexão cair, ela tenta de novo e a capa também se atualiza periodicamente. A velocidade ainda depende de quando cada veículo publica o RSS.</p>
        <p>Links originais, horário de publicação em UTC e horário no seu fuso ficam visíveis. Operações de fonte, alerta e pesquisa salva exigem sessão. O painel de saúde não mostra senhas nem chaves.</p>
      </div>
    </article>
  );
}
