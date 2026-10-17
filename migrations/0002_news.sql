-- Pulso: notícias, fontes, análise, acontecimentos e preferências.

create table if not exists sources (
  id text primary key,
  name text not null,
  type text not null,
  base_url text not null,
  feed_url text,
  enabled boolean not null default true,
  poll_interval_seconds integer not null default 900,
  config jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  next_poll_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists articles (
  id text primary key,
  source_id text not null references sources (id) on delete cascade,
  external_id text not null,
  url text not null,
  canonical_url text not null,
  title text not null,
  description text,
  content_excerpt text,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  language text not null default 'pt',
  content_hash text not null,
  search_text text not null default '',
  search_vector tsvector,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_source_external_unique unique (source_id, external_id),
  constraint articles_source_hash_unique unique (source_id, content_hash)
);

create index if not exists articles_published_idx on articles (published_at desc);
create index if not exists articles_discovered_idx on articles (discovered_at desc);
create index if not exists articles_source_idx on articles (source_id);
create index if not exists articles_search_idx on articles using gin (search_vector);

create table if not exists article_analysis (
  article_id text primary key references articles (id) on delete cascade,
  summary text,
  category text,
  entities_json jsonb not null default '[]'::jsonb,
  model_provider text,
  model_version text,
  prompt_version text,
  processing_status text not null default 'pending',
  processed_at timestamptz,
  error_message text,
  input_tokens integer,
  output_tokens integer,
  requested_by text
);

create table if not exists topics (
  id text primary key,
  user_id text references "user" (id) on delete cascade,
  name text not null,
  keywords text[] not null default array[]::text[],
  exclusions text[] not null default array[]::text[],
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists article_topics (
  article_id text not null references articles (id) on delete cascade,
  topic_id text not null references topics (id) on delete cascade,
  primary key (article_id, topic_id)
);

create table if not exists events (
  id text primary key,
  title text not null,
  summary text,
  summary_provider text,
  summary_model text,
  summarized_at timestamptz,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  article_count integer not null default 0
);

create table if not exists event_articles (
  event_id text not null references events (id) on delete cascade,
  article_id text not null unique references articles (id) on delete cascade,
  similarity numeric,
  primary key (event_id, article_id)
);

create index if not exists event_articles_event_idx on event_articles (event_id);

create table if not exists saved_searches (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  name text not null,
  query text not null,
  filters_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists saved_searches_user_idx on saved_searches (user_id, created_at desc);

create table if not exists alerts (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  topic_id text references topics (id) on delete set null,
  name text not null,
  query text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists alerts_user_idx on alerts (user_id);

create table if not exists alert_hits (
  id text primary key,
  alert_id text not null references alerts (id) on delete cascade,
  article_id text not null references articles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint alert_hits_unique unique (alert_id, article_id)
);

create index if not exists alert_hits_alert_idx on alert_hits (alert_id, created_at desc);

create table if not exists ingestion_runs (
  id text primary key,
  source_id text references sources (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  items_found integer not null default 0,
  items_new integer not null default 0,
  items_duplicate integer not null default 0,
  error_message text,
  duration_ms integer
);

create index if not exists ingestion_runs_source_idx on ingestion_runs (source_id, started_at desc);

create table if not exists processing_jobs (
  id text primary key,
  article_id text references articles (id) on delete cascade,
  kind text not null,
  status text not null,
  attempts integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  user_id text,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);

insert into sources (id, name, type, base_url, feed_url, enabled, poll_interval_seconds, config)
values
  ('g1', 'G1', 'rss', 'https://g1.globo.com', 'https://g1.globo.com/rss/g1/', true, 900, '{"categoryHint":""}'::jsonb),
  ('bbc-brasil', 'BBC News Brasil', 'rss', 'https://www.bbc.com/portuguese', 'https://feeds.bbci.co.uk/portuguese/rss.xml', true, 900, '{}'::jsonb),
  ('agencia-brasil', 'Agência Brasil', 'rss', 'https://agenciabrasil.ebc.com.br', 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', true, 900, '{}'::jsonb),
  ('tecnoblog', 'Tecnoblog', 'rss', 'https://tecnoblog.net', 'https://tecnoblog.net/feed/', true, 900, '{"categoryHint":"Tecnologia"}'::jsonb),
  ('cnn-brasil', 'CNN Brasil', 'rss', 'https://www.cnnbrasil.com.br', 'https://www.cnnbrasil.com.br/feed/', true, 900, '{}'::jsonb),
  ('folha', 'Folha de S.Paulo', 'rss', 'https://www.folha.uol.com.br', 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', true, 900, '{}'::jsonb),
  ('youtube-pendente', 'YouTube (credencial pendente)', 'youtube', 'https://www.googleapis.com/youtube/v3', null, false, 3600, '{"status":"pending_credentials"}'::jsonb),
  ('x-pendente', 'X (credencial pendente)', 'x', 'https://api.x.com', null, false, 3600, '{"status":"pending_credentials"}'::jsonb)
on conflict (id) do nothing;

insert into topics (id, name, keywords, exclusions, enabled)
values
  ('politica', 'Política', '{congresso,governo,eleicao,stf,senado,camara,presidente,deputado,planalto}', '{}', true),
  ('economia', 'Economia', '{inflacao,juros,dolar,pib,selic,bolsa,mercado}', '{}', true),
  ('tecnologia', 'Tecnologia', '{software,aplicativo,inteligencia,chip,startup,internet,celular}', '{}', true),
  ('saude', 'Saúde', '{saude,hospital,sus,dengue,medico,vacina}', '{}', true),
  ('seguranca', 'Segurança pública', '{policia,homicidio,prisao,crime,trafico}', '{}', true),
  ('ambiente', 'Meio ambiente', '{amazonia,clima,desmatamento,incendio,ambiental}', '{}', true),
  ('esportes', 'Esportes', '{futebol,campeonato,jogador,gol,brasileirao}', '{}', true),
  ('internacional', 'Internacional', '{eua,china,onu,europa,ucrania,gaza}', '{}', true)
on conflict (id) do nothing;
