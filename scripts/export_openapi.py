"""Export the FastAPI app's OpenAPI schema to a file.

Used by `make openapi-export` so the frontend can regenerate
`src/api/types.ts` from the live spec.

Why a script (not an inline `python -c`): `build_app()` calls
`configure_logging()` which installs a stdout handler, which would
contaminate the JSON if we wrote to stdout. Writing the JSON directly
to the destination file sidesteps that.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pd_prep_for_pgdp.bootstrap import build_app


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: export_openapi.py <output-path>", file=sys.stderr)  # noqa: T201  # usage msg to stderr
        raise SystemExit(2)
    out = Path(sys.argv[1])
    app = build_app()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), indent=2) + "\n")


if __name__ == "__main__":
    main()
