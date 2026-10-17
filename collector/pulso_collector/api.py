import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from pulso_collector.collect import collect, connect


class CollectIn(BaseModel):
    force: bool = False


async def _loop() -> None:
    while True:
        try:
            await asyncio.to_thread(collect, False)
            _remember(True)
            await asyncio.sleep(60)
        except Exception as error:
            _remember(False)
            print(f"pulso.collector.loop {type(error).__name__}: {error}", flush=True)
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Pulso coletor", version="1", lifespan=lifespan)


_db_ready = False


@app.get("/")
def root():
    return {"ok": _db_ready, "service": "pulso-collector"}


@app.get("/health")
def health():
    if _db_ready:
        return {"ok": True}
    try:
        with connect() as conn:
            conn.execute("select 1")
        _remember(True)
        return {"ok": True}
    except Exception:
        return JSONResponse({"ok": False}, status_code=503)


def _remember(value: bool) -> None:
    global _db_ready
    _db_ready = value


@app.post("/v1/collect")
def collect_now(body: CollectIn):
    try:
        report = collect(body.force)
        _remember(True)
    except Exception as error:
        _remember(False)
        print(f"pulso.collector.error {type(error).__name__}: {error}", flush=True)
        return JSONResponse({"ok": False}, status_code=503)
    return report
