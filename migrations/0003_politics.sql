-- Marcelus News: a edição passa a cobrir política e eleições.

update sources set
  name = 'G1 Política',
  base_url = 'https://g1.globo.com/politica/',
  feed_url = 'https://g1.globo.com/rss/g1/politica/',
  config = '{"categoryHint":"Política"}'::jsonb,
  enabled = true,
  last_attempt_at = null,
  next_poll_at = null,
  updated_at = now()
where id = 'g1';

update sources set
  name = 'Folha Poder',
  base_url = 'https://www1.folha.uol.com.br/poder/',
  feed_url = 'https://feeds.folha.uol.com.br/poder/rss091.xml',
  config = '{"categoryHint":"Política"}'::jsonb,
  enabled = true,
  last_attempt_at = null,
  next_poll_at = null,
  updated_at = now()
where id = 'folha';

update sources set
  config = '{"categoryHint":"Política"}'::jsonb,
  last_attempt_at = null,
  next_poll_at = null,
  updated_at = now()
where id in ('cnn-brasil', 'agencia-brasil', 'bbc-brasil');

update sources set enabled = false, updated_at = now() where id = 'tecnoblog';

insert into sources (id, name, type, base_url, feed_url, enabled, poll_interval_seconds, config)
values
  ('poder360', 'Poder360', 'rss', 'https://www.poder360.com.br', 'https://www.poder360.com.br/feed/', true, 900, '{"categoryHint":"Política"}'::jsonb),
  ('camara', 'Câmara dos Deputados', 'rss', 'https://www.camara.leg.br', 'https://www.camara.leg.br/noticias/rss/dinamico/POLITICA', true, 900, '{"categoryHint":"Política"}'::jsonb),
  ('senado', 'Senado Federal', 'rss', 'https://www12.senado.leg.br', 'https://www12.senado.leg.br/noticias/rss', true, 900, '{"categoryHint":"Política"}'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  base_url = excluded.base_url,
  feed_url = excluded.feed_url,
  enabled = true,
  config = excluded.config,
  last_attempt_at = null,
  next_poll_at = null,
  updated_at = now();
