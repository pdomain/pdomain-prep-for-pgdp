"""GPU dispatch primitives live in pdomain_ops.gpu — import from there directly.

This module was a transitional shim. All ``dispatcher/*`` consumers have been
migrated in Task B1 to ``from pdomain_ops.gpu import ...``.

Shim re-exports removed. This file is kept as a package marker only.
"""
