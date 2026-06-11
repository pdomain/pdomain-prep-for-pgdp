"""PGDP filename naming compliance utilities.

Authoritative rules from the DP wiki Content Providing FAQ:
  https://www.pgdp.net/wiki/DP_Official_Documentation:CP_and_PM/Content_Providing_FAQ

Rule summary (as of 2026-06):
  - Page image (.png) and text (.txt) files MUST share the same basename
    (e.g. 005.png ↔ 005.txt).
  - A simple filename sort must put pages in book-binding order; convention is
    zero-padded serial 001... (0001... for >999 pages).
  - Basename ≤ 8 characters (≤ 12 with extension); allowed characters: letters,
    digits, ``-``, ``_``, ``.`` (note: dot is only in the extension, not in the
    basename itself); extensions lowercase, one of .png/.jpg/.txt.
  - Avoid the substring "ad" in filenames — proofers' ad-blockers hide such images.
  - Illustrations: high-quality .jpg for photos/shaded art, .png for line art;
    same naming rules; uploaded in the same zip under the ``images/`` subfolder.

This module provides pure functions (no I/O, no side effects):
  1. validate_pgdp_filename(basename, ext) -> list[str]
     Validate a single file's basename and extension against PGDP rules.
     Returns a list of error code strings (empty = compliant).

  2. validate_package_naming(names, page_order) -> list[str]
     Validate a whole zip-entry name list against PGDP rules.
     Checks: matched png/txt pairs, per-file rules, optional sort order.

  3. PgdpNamingError — exception raised by build_package hard-assert.
"""

from __future__ import annotations

import re

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# Allowed extensions (lowercase only; .jpg covers illustration images).
_ALLOWED_EXTENSIONS: frozenset[str] = frozenset({".png", ".txt", ".jpg"})

# Maximum basename length (PGDP rule: ≤ 8 chars).
_MAX_BASENAME_LEN: int = 8

# Pattern for valid basename characters: letters, digits, hyphen, underscore.
# Dot is NOT allowed in the basename (it belongs only to the extension separator).
_VALID_BASENAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")


# ─────────────────────────────────────────────────────────────────────────────
# Exception
# ─────────────────────────────────────────────────────────────────────────────


class PgdpNamingError(ValueError):
    """Raised by build_submission_zip when the package has PGDP naming violations.

    The message contains semicolon-separated error codes so callers can
    extract them with ``"some_code" in str(err)``.
    """


# ─────────────────────────────────────────────────────────────────────────────
# 1. validate_pgdp_filename — single-file rules
# ─────────────────────────────────────────────────────────────────────────────


def validate_pgdp_filename(basename: str, ext: str) -> list[str]:
    """Validate a single file basename and extension against PGDP naming rules.

    The ``basename`` is the filename *without* extension (e.g. "f001").
    The ``ext`` is the extension *including* the leading dot (e.g. ".png").

    Rules checked:
      - basename_too_long   : len(basename) > 8
      - invalid_chars       : basename contains characters outside [A-Za-z0-9_-]
      - uppercase_ext       : extension is not fully lowercase
      - disallowed_ext      : extension is not one of .png / .txt / .jpg
      - ad_substring        : "ad" appears in basename (case-insensitive)

    Returns a list of error-code strings. An empty list means the filename
    is compliant with PGDP rules.

    Reference:
      https://www.pgdp.net/wiki/DP_Official_Documentation:CP_and_PM/Content_Providing_FAQ
    """
    errors: list[str] = []

    # Rule 1: basename length ≤ 8 chars
    if len(basename) > _MAX_BASENAME_LEN:
        errors.append(f"basename_too_long:{basename!r} has {len(basename)} chars (max {_MAX_BASENAME_LEN})")

    # Rule 2: allowed chars in basename
    if not _VALID_BASENAME_RE.match(basename):
        errors.append(f"invalid_chars:{basename!r} contains characters outside [A-Za-z0-9_-]")

    # Rule 3: extension must be lowercase
    if ext != ext.lower():
        errors.append(f"uppercase_ext:{ext!r} is not lowercase")

    # Rule 4: extension must be one of the allowed set
    if ext.lower() not in _ALLOWED_EXTENSIONS:
        errors.append(f"disallowed_ext:{ext!r} is not in {sorted(_ALLOWED_EXTENSIONS)}")

    # Rule 5: avoid "ad" substring (case-insensitive) — ad-blockers hide such images
    if "ad" in basename.lower():
        errors.append(f"ad_substring:{basename!r} contains the substring 'ad' (ad-blocker risk)")

    return errors


# ─────────────────────────────────────────────────────────────────────────────
# 2. validate_package_naming — whole-package set
# ─────────────────────────────────────────────────────────────────────────────


def validate_package_naming(
    names: list[str],
    *,
    page_order: list[str] | None = None,
) -> list[str]:
    """Validate a list of zip-entry names against PGDP naming rules.

    ``names`` is the full list of filenames that will appear in the submission
    zip (e.g. ["f001.png", "f001.txt", "images/p001_01.jpg", "pgdp.json"]).
    Entries under "images/" are treated as illustration images and are not
    required to have a paired .txt.

    ``page_order`` (optional) is the ordered list of page IDs whose prefixes
    determine the expected reading order. When supplied, the function checks
    that the lexicographic sort of proofing-image basenames matches the
    page_order sequence. That is, sorted(proofing_basenames) must be
    consistent with the page-order index.

    Checks performed:
      1. Per-file rules (validate_pgdp_filename) for every entry not under
         "pgdp.json" or other known manifest names.
      2. Matched pairs: every .png proofing file must have a corresponding
         .txt file with the same basename and vice versa.
      3. Sort order: when page_order is provided, sorted proofing basenames
         must align with page_order reading order.

    Returns a list of error-code strings. An empty list means compliant.

    Reference:
      https://www.pgdp.net/wiki/DP_Official_Documentation:CP_and_PM/Content_Providing_FAQ
    """
    errors: list[str] = []

    # Skip known non-page entries
    _SKIP_NAMES: frozenset[str] = frozenset({"pgdp.json"})

    proofing_png: set[str] = set()
    proofing_txt: set[str] = set()
    # basenames in the order they first appear for page_order comparison
    proofing_basenames_in_order: list[str] = []

    for name in names:
        if name in _SKIP_NAMES:
            continue

        # Normalise path separators
        filename = name.replace("\\", "/").split("/")[-1]
        if "." not in filename:
            continue  # no extension — skip (e.g. directory entries)

        dot_idx = filename.rfind(".")
        basename = filename[:dot_idx]
        ext = filename[dot_idx:]

        # Per-file rule check; skip illustration entries under images/
        is_illustration = name.startswith("images/") or name.startswith("images\\")
        if not is_illustration:
            file_errors = validate_pgdp_filename(basename, ext)
            errors.extend(file_errors)

        # Collect proofing pairs (top-level .png and .txt files)
        if not is_illustration:
            if ext.lower() == ".png":
                proofing_png.add(basename)
                proofing_basenames_in_order.append(basename)
            elif ext.lower() == ".txt":
                proofing_txt.add(basename)

    # Rule: matched png/txt pairs
    png_only = proofing_png - proofing_txt
    txt_only = proofing_txt - proofing_png
    for basename in sorted(png_only):
        errors.append(f"missing_txt:{basename}.png has no matching {basename}.txt")
    for basename in sorted(txt_only):
        errors.append(f"missing_png:{basename}.txt has no matching {basename}.png")

    # Rule: sort order vs page_order
    if page_order is not None and len(proofing_basenames_in_order) > 0:
        # Build the expected order: the i-th page_order entry corresponds to the
        # i-th proofing basename (by the page_prefixes mapping used to populate names).
        # We can't recover the page_id→basename mapping here, but we CAN check that
        # sorted(basenames) is consistent with the sequence provided:
        # the first page in page_order should correspond to the lowest-sorting basename
        # ONLY IF the caller provided names already in page_order sequence.
        #
        # Concretely: names are appended in page_order sequence by build_submission_zip.
        # So proofing_basenames_in_order[i] is the basename for page_order[i].
        # We verify that sorted(proofing_basenames_in_order) == proofing_basenames_in_order
        # when page_order demands that sort order equals reading order.
        #
        # A simpler invariant that is always verifiable: the basenames as supplied
        # (which ARE in page_order sequence) must have the property that
        # lexicographic sort produces the same sequence. If they don't, it means
        # the prefix assignments don't agree with reading order under simple filename sort.
        page_ordered_basenames = proofing_basenames_in_order
        sort_ordered_basenames = sorted(proofing_basenames_in_order)
        if page_ordered_basenames != sort_ordered_basenames:
            errors.append(
                f"sort_order:filenames sorted lexicographically {sort_ordered_basenames!r} "
                f"disagree with page reading order {page_ordered_basenames!r}"
            )

    return errors
