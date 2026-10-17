import os

import uvicorn

from pulso_collector.api import app


def main() -> None:
    port = int(os.environ.get("COLLECTOR_PORT", "8091"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
