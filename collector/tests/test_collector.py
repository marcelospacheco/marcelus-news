import time
import unittest

from pulso_collector.collect import _upsert, _cluster, connect
from pulso_collector.feeds import parse_feed
from pulso_collector.textutil import content_hash, fold, story_similarity
from pulso_collector.urls import assert_public_http_url, canonical_url, is_private_host


RSS = """<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title><![CDATA[Senado vota a PEC]]></title><link>https://exemplo.com/pec?utm_source=rss</link><guid>pec-1</guid><description>O <a href="https://exemplo.com/x">plenário</a> discute.</description></item>
  <item><title>Sem link</title><description>ignorar</description></item>
</channel></rss>"""


class PureTests(unittest.TestCase):
    def test_fold_and_hash(self):
        self.assertEqual(fold("  Eleição   na Câmara "), "eleicao na camara")
        left = content_hash("https://exemplo.com/a", "Eleição")
        right = content_hash("https://exemplo.com/a", "eleição")
        self.assertEqual(left, right)
        self.assertNotEqual(left, content_hash("https://exemplo.com/b", "Eleição"))

    def test_canonical_and_private(self):
        self.assertEqual(
            canonical_url("https://EXEMPLO.com/noticia?id=10&utm_source=rss&fbclid=abc"),
            "https://exemplo.com/noticia?id=10",
        )
        for host in ("localhost", "127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.8", "[::1]"):
            self.assertTrue(is_private_host(host), host)
        with self.assertRaises(ValueError):
            assert_public_http_url("http://169.254.169.254/latest")
        with self.assertRaises(ValueError):
            assert_public_http_url("file:///etc/passwd")

    def test_feed_and_similarity(self):
        items = parse_feed(RSS)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["title"], "Senado vota a PEC")
        self.assertIn("plenário", str(items[0]["description"]))
        self.assertNotIn("<", str(items[0]["description"]))
        same = story_similarity(
            {"title": "Congresso promulga emenda do fim da escala 6x1", "canonical_url": "https://a.example/1"},
            {"title": "Fim da escala 6x1 é promulgado pelo Congresso", "canonical_url": "https://b.example/2"},
        )
        other = story_similarity(
            {"title": "Apple lança novo iPhone no Brasil", "canonical_url": "https://a.example/3"},
            {"title": "Chuva forte atinge o litoral de Santa Catarina", "canonical_url": "https://b.example/4"},
        )
        self.assertGreaterEqual(same, 0.4)
        self.assertEqual(other, 0)
        with self.assertRaises(ValueError):
            parse_feed("<html><title>não é feed</title></html>")


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        last = "sem conexão"
        for _ in range(12):
            try:
                self.conn = connect()
                self.conn.execute("select 1 from sources limit 1")
                return
            except Exception as error:
                last = error
                time.sleep(0.4)
        self.skipTest(f"PostgreSQL do coletor indisponível: {last}")

    def tearDown(self):
        if hasattr(self, "conn"):
            self.conn.execute("delete from sources where id in ('teste-coletor', 'teste-coletor-b')")
            self.conn.execute("delete from events where title = 'Senado vota a PEC'")
            if not self.conn.autocommit:
                self.conn.commit()
            self.conn.close()

    def test_dedup_and_cluster(self):
        self._source("teste-coletor", "https://example.com")
        self._source("teste-coletor-b", "https://example.org")
        item = parse_feed(RSS)[0]
        source = {"id": "teste-coletor", "config": {}}
        first = _upsert(self.conn, source, item)
        second = _upsert(self.conn, source, item)
        self.assertEqual(first["kind"], "new")
        self.assertEqual(second["kind"], "duplicate")
        other = dict(item)
        other["url"] = "https://example.org/pec"
        other["external_id"] = "pec-folha"
        third = _upsert(self.conn, {"id": "teste-coletor-b", "config": {}}, other)
        self.assertEqual(third["kind"], "new")
        _cluster(self.conn, [first["fresh"]["id"], third["fresh"]["id"]])
        if not self.conn.autocommit:
            self.conn.commit()
        count = self.conn.execute("select count(*) as n from articles where source_id like 'teste-coletor%'").fetchone()
        events = self.conn.execute(
            """
            select count(*) as n from event_articles
            where article_id in (select id from articles where source_id like 'teste-coletor%')
            """
        ).fetchone()
        self.assertEqual(count["n"], 2)
        self.assertEqual(events["n"], 2)

    def _source(self, source_id: str, base: str) -> None:
        self.conn.execute(
            """
            insert into sources (id, name, type, base_url, feed_url, enabled, poll_interval_seconds, config)
            values (%s, 'Teste', 'rss', %s, %s, false, 900, '{}'::jsonb)
            on conflict (id) do nothing
            """,
            (source_id, base, base + "/rss.xml"),
        )


if __name__ == "__main__":
    unittest.main()
