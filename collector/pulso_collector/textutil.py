import hashlib
import re
import unicodedata

STOP = {
    "de", "da", "do", "das", "dos", "a", "o", "e", "em", "para", "com", "que",
    "no", "na", "nos", "nas", "um", "uma", "por", "se", "ao", "as", "os", "nao",
    "mais", "sobre", "apos", "entre", "como", "sua", "seu", "foi", "sao", "ser",
    "esta", "este", "isso", "ja", "ou", "the", "of", "and", "pela", "pelo",
    "seus", "suas", "ele", "ela", "eles", "elas", "ate", "sem", "sob",
}

RULES: list[tuple[str, list[str]]] = [
    ("Esportes", ["futebol", "gol", "campeonato", "jogador", "tecnico", "olimpiada", "libertadores", "brasileirao", "nba", "tenis"]),
    ("Tecnologia", ["software", "aplicativo", "inteligencia artificial", "chip", "celular", "startup", "ciber", "internet", "iphone", "google", "microsoft"]),
    ("Ciência", ["pesquisa", "cientista", "estudo", "universidade", "nasa", "vacina", "laboratorio"]),
    ("Saúde", ["saude", "hospital", "sus", "doenca", "medico", "medic", "epidemia", "dengue"]),
    ("Economia", ["inflacao", "juros", "dolar", "pib", "banco central", "selic", "mercado", "bolsa"]),
    ("Negócios", ["empresa", "fusao", "lucro", "acionista", "investimento", "receita"]),
    ("Política", ["congresso", "governo", "eleicao", "stf", "senado", "camara", "presidente", "deputado", "ministro", "planalto"]),
    ("Segurança pública", ["policia", "homicidio", "trafico", "prisao", "crime", "delegacia"]),
    ("Meio ambiente", ["clima", "amazonia", "desmatamento", "incendio", "ambiental", "chuva", "seca"]),
    ("Cultura", ["filme", "cinema", "musica", "show", "artista", "festival", "livro", "novela"]),
    ("Notícias locais", ["prefeitura", "bairro", "municipio", "camara municipal"]),
    ("Internacional", ["eua", "china", "onu", "ucrania", "gaza", "europa", "israel", "trump"]),
]

CLUSTER_THRESHOLD = 0.4


def fold(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    stripped = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return " ".join(stripped.lower().split())


def clip(value: str, limit: int) -> str:
    text = " ".join(value.split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def content_hash(canonical: str, title: str) -> str:
    return hashlib.sha256(f"{canonical}\n{fold(title)}".encode()).hexdigest()


def title_tokens(title: str) -> list[str]:
    tokens = re.sub(r"[^a-z0-9\s]", " ", fold(title)).split()
    unique: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if len(token) <= 2 or token in STOP or token in seen:
            continue
        seen.add(token)
        unique.append(token)
    return unique


def jaccard(left: list[str], right: list[str]) -> float:
    if not left or not right:
        return 0
    right_set = set(right)
    shared = sum(1 for token in left if token in right_set)
    return shared / (len(left) + len(right_set) - shared)


def story_similarity(left: dict[str, str], right: dict[str, str]) -> float:
    if left.get("canonical_url") and left["canonical_url"] == right.get("canonical_url"):
        return 1
    a = title_tokens(left.get("title", ""))
    b = title_tokens(right.get("title", ""))
    shared = len(set(a) & set(b))
    if shared < 2:
        return 0
    score = jaccard(a, b)
    if len(a) <= 3 and len(b) <= 3 and score < 0.6:
        return 0
    return score


def classify_text(text: str, hint: str | None = None) -> str:
    hay = fold(text)
    best = "Geral"
    best_score = 0
    for category, words in RULES:
        score = 2 if hint == category else 0
        for word in words:
            if word in hay:
                score += 1
        if score > best_score:
            best = category
            best_score = score
    return best if best_score > 0 else "Geral"


def covers_politics(text: str) -> bool:
    hay = fold(text)
    election = any(word in hay for word in ("eleic", "urna", "candidato", "candidat", "tse", "campanha", "pleito", "eleitor", "coligac"))
    politics = classify_text(text) == "Política" or election or any(
        word in hay for word in ("congresso", "senado", "camara", "stf", "planalto", "deputad", "ministro", "partido", "governo", "impeach", "votac")
    )
    if not politics:
        return False
    sports = any(word in hay for word in ("futebol", "campeonato", "jogador", "brasileirao", "libertadores"))
    hard = any(word in hay for word in ("eleic", "congresso", "senado", "stf", "planalto", "deputad", "urna", "tse", "pleito"))
    return not (sports and not hard)


def plain_body(value: str) -> str:
    from html import unescape

    text = unescape(unescape(value))
    text = re.sub(r"<!\[CDATA\[([\s\S]*?)\]\]>", r"\1", text)
    text = unescape(text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|h[1-6]|li|blockquote)>", "\n\n", text, flags=re.I)
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r" +([.,;:!?])", r"\1", text)
    return text.strip()


def strip_html(value: str) -> str:
    import re

    text = re.sub(r"<!\[CDATA\[([\s\S]*?)\]\]>", r"\1", value)
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(text.split())
