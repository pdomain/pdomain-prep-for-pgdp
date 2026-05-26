"""Adapters: storage, database, auth, GPU.

One implementation of each is selected at startup by `bootstrap.build_app()`
based on the runtime `Settings`. Pipeline / API code only ever sees the
Protocol interfaces defined in each subpackage.
"""
