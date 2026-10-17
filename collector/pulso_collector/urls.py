from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "fbclid", "gclid", "mc_cid", "mc_eid", "at_medium", "at_campaign", "outputtype", "ref",
}


def canonical_url(raw: str) -> str:
    parts = urlsplit(raw.strip())
    if parts.scheme not in ("http", "https"):
        raise ValueError("A URL precisa usar http ou https.")
    host = (parts.hostname or "").lower()
    if not host:
        raise ValueError("URL inválida.")
    port = parts.port
    if ":" in host:
        netloc = f"[{host}]"
        if port and not _default_port(parts.scheme, port):
            netloc = f"[{host}]:{port}"
    else:
        netloc = host if port is None or _default_port(parts.scheme, port) else f"{host}:{port}"
    pairs = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key.lower() not in TRACKING]
    pairs.sort()
    return urlunsplit((parts.scheme, netloc, parts.path or "", urlencode(pairs), ""))


def assert_public_http_url(raw: str) -> str:
    try:
        parts = urlsplit(raw.strip())
    except ValueError as error:
        raise ValueError("URL inválida.") from error
    if parts.scheme not in ("http", "https"):
        raise ValueError("Só são permitidos endereços http ou https.")
    if parts.username or parts.password:
        raise ValueError("URL com usuário ou senha não é aceita.")
    host = parts.hostname or ""
    if is_private_host(host):
        raise ValueError("Endereço interno ou local não é permitido.")
    return canonical_url(raw)


def is_private_host(hostname: str) -> bool:
    host = hostname.lower().strip("[]")
    if host in {"localhost", "0.0.0.0", "::", "::1", "metadata.google.internal"} or host.endswith(".localhost") or host.endswith(".local"):
        return True
    pieces = host.split(".")
    if len(pieces) == 4 and all(piece.isdigit() for piece in pieces):
        numbers = [int(piece) for piece in pieces]
        if any(number > 255 for number in numbers):
            return True
        a, b = numbers[0], numbers[1]
        if a in {10, 127, 0}:
            return True
        if a == 169 and b == 254:
            return True
        if a == 172 and 16 <= b <= 31:
            return True
        if a == 192 and b == 168:
            return True
        if a == 100 and 64 <= b <= 127:
            return True
        return False
    if ":" in host:
        head = host.split(":", 1)[0]
        if head in {"", "fe80"} or head.startswith("fc") or head.startswith("fd"):
            return True
    return False


def safe_image_url(raw: str | None, base: str) -> str | None:
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
        absolute = raw if parts.scheme else urlunsplit(urlsplit(base)._replace(path=_join_path(urlsplit(base).path, raw), query="", fragment=""))
        if urlsplit(absolute).scheme != "https":
            return None
        cleaned = assert_public_http_url(absolute)
        if len(cleaned) > 1000:
            return None
        return cleaned
    except ValueError:
        return None


def _default_port(scheme: str, port: int) -> bool:
    return (scheme == "https" and port == 443) or (scheme == "http" and port == 80)


def _join_path(base_path: str, raw: str) -> str:
    if raw.startswith("/"):
        return raw.split("?", 1)[0]
    prefix = base_path.rsplit("/", 1)[0]
    return f"{prefix}/{raw.split('?', 1)[0]}"
