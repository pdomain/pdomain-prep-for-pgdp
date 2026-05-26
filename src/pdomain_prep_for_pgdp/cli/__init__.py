"""CLI subcommands for the `pgdp-prep` entry point.

Each module in this package implements one subcommand and exposes a
``main(argv: list[str]) -> int`` that returns a process exit code. The
top-level ``__main__.py`` dispatches to these when the user invokes
``pgdp-prep <subcommand>``; otherwise it falls through to the default
"start the FastAPI server" behaviour.
"""
