# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Audit the locked Python and frontend dependencies for published advisories."""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_REQUIREMENT_NAME = re.compile(r"^[A-Za-z0-9._-]+")


def public_requirements(exported: str) -> str:
    """Drop comments and private pdomain packages, which no public advisory database covers."""
    kept: list[str] = []
    for raw in exported.splitlines():
        line = raw.strip()
        name = _REQUIREMENT_NAME.match(line)
        if name is None or name.group().lower().replace("_", "-").startswith("pdomain-"):
            continue
        kept.append(line)
    return "".join(f"{line}\n" for line in kept)


def overall_status(python_status: int, frontend_status: int) -> int:
    return 1 if python_status or frontend_status else 0


def _audit_python() -> int:
    exported = subprocess.run(
        [
            "uv",
            "export",
            "--frozen",
            "--no-hashes",
            "--no-emit-project",
            "--no-dev",
            "--format",
            "requirements-txt",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    with tempfile.TemporaryDirectory() as tmp:
        requirements = Path(tmp) / "requirements.txt"
        _ = requirements.write_text(public_requirements(exported))
        return subprocess.run(
            ["uvx", "pip-audit", "--no-deps", "--disable-pip", "-r", str(requirements)],
            cwd=ROOT,
            check=False,
        ).returncode


def _audit_frontend() -> int:
    return subprocess.run(["pnpm", "--dir", "frontend", "audit", "--prod"], cwd=ROOT, check=False).returncode


def main() -> int:
    return overall_status(_audit_python(), _audit_frontend())


if __name__ == "__main__":
    sys.exit(main())
