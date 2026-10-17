# Pulso — arquitetura

O produto que roda é um aplicativo web único. O pedido original descrevia FastAPI, Celery, Redis, Next.js e Docker. Esse conjunto não é o alvo de publicação desta plataforma: ela entrega um app TanStack Start, com Postgres (Neon quando publicado; Postgres embutido no preview) e funções de servidor. O domínio pedido foi implementado nesse formato, sem um segundo backend que o leitor não conseguiria abrir.

## Decisões

- Um processo web, módulos por domínio (`rss`, `url`, `text`, `ingest`, `queries`, `ai`), em vez de microsserviços.
- Conectores: RSS/Atom de verdade. YouTube e X existem no cadastro, desligados, e recusam coleta sem credencial. Não há notícia simulada no feed.
- Idempotência: unicidade `(source_id, external_id)` e `(source_id, content_hash)`. Reprocessar não duplica. Itens parecidos de fontes diferentes viram acontecimento, não são apagados.
- Busca: texto normalizado sem acento, `ILIKE` e `tsvector` (`simple`) no Postgres. Sem embeddings nesta versão.
- IA: Grok (`grok-4.5`) só por ação do usuário, com resultado gravado, teto por hora e o trecho tratado como dado não confiável. Categoria inicial é heurística e aparece como estimativa.
- Tempo real: SSE em memória no processo (`article.created`, `article.updated`, `event.updated`) mais revalidação da interface. Não há fila Redis; a coleta é agendada no processo e também ao abrir a capa quando a fonte está vencida.
- Sessão: Better Auth (Google e X, e a sessão automática de quem já entrou pelo Grok). Fontes, alertas, pesquisas e IA exigem usuário. A leitura das notícias é pública.
- SSRF: só http(s), sem usuário na URL, sem host local ou IP privado, redirecionamento manual, tamanho e tempo limitados.

## O que não está nesta versão

- Docker, Celery e workers separados. A coleta vive no servidor do app e respeita o intervalo de cada fonte.
- APIs pagas de notícias, YouTube Data API e X API, até existirem credenciais oficiais.
- E-mail ou push de alerta. O alerta é uma lista dentro do app.
- Cópia integral de matérias protegidas.

## Fluxo

1. O agendador, ou o botão atualizar, escolhe fontes RSS vencidas.
2. Cada feed é lido com timeout, limite e redirecionamento conferido.
3. Itens viram o formato interno, em UTC, com URL canônica e hash.
4. Inserção idempotente. Novos itens ganham categoria estimada, temas e alertas.
5. Um passo agrupa títulos próximos no tempo.
6. A interface recebe o evento e busca o detalhe de novo.
7. A IA, se pedida, grava resumo, categoria e entidades.
