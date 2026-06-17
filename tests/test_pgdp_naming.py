"""TDD tests for PGDP filename naming compliance.

Rules sourced from the DP wiki Content Providing FAQ:
  https://www.pgdp.net/wiki/DP_Official_Documentation:CP_and_PM/Content_Providing_FAQ

Covered:
1. validate_pgdp_filename — single basename + ext validation
2. validate_package_naming — whole-package set validation (pairs + sort + coverage)
3. Current compute_prefix output compliance (regression guard)
4. build_submission_zip hard-assert on naming violations
5. validation stage PGDP naming rules as blockers
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02"
    b"\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _make_clean_page(tmp_path: Path, project_id: str, page_id: str) -> None:
    """Create minimal clean page artifacts under tmp_path."""
    stages = tmp_path / "projects" / project_id / "pages" / page_id / "stages"
    img_dir = stages / "canvas_map"
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / "output.png").write_bytes(_PNG_BYTES)
    txt_dir = stages / "text_review"
    txt_dir.mkdir(parents=True, exist_ok=True)
    (txt_dir / "output.txt").write_text("text\n", encoding="utf-8")
    (txt_dir / "attestation.json").write_bytes(json.dumps({"status": "clean"}).encode())


# ────────────────────────────────────────────────────────────────────────────
# 1. validate_pgdp_filename — single-file rules
# ────────────────────────────────────────────────────────────────────────────


class TestValidatePgdpFilename:
    """Unit tests for validate_pgdp_filename(basename, ext) -> list[str]."""

    def _validate(self, basename: str, ext: str) -> list[str]:
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_pgdp_filename

        return validate_pgdp_filename(basename, ext)

    # ── valid cases ──────────────────────────────────────────────────────────

    def test_valid_png_short(self) -> None:
        assert self._validate("f001", ".png") == []

    def test_valid_txt_short(self) -> None:
        assert self._validate("p045", ".txt") == []

    def test_valid_8_char_basename(self) -> None:
        assert self._validate("f1234567", ".png") == []

    def test_valid_with_underscore(self) -> None:
        assert self._validate("f_001", ".png") == []

    def test_valid_with_hyphen(self) -> None:
        assert self._validate("f-001", ".png") == []

    def test_valid_jpg_extension(self) -> None:
        assert self._validate("img001", ".jpg") == []

    def test_valid_jpg_illustration(self) -> None:
        assert self._validate("p001il", ".jpg") == []

    # ── length violations ────────────────────────────────────────────────────

    def test_9_char_basename_is_violation(self) -> None:
        # 9 chars > 8-char limit
        errors = self._validate("abcdefghi", ".png")
        assert any("basename_too_long" in e for e in errors)

    def test_1_char_basename_is_ok(self) -> None:
        assert self._validate("a", ".png") == []

    # ── extension case violations ────────────────────────────────────────────

    def test_uppercase_extension_png_is_violation(self) -> None:
        errors = self._validate("f001", ".PNG")
        assert any("uppercase_ext" in e for e in errors)

    def test_uppercase_extension_txt_is_violation(self) -> None:
        errors = self._validate("p001", ".TXT")
        assert any("uppercase_ext" in e for e in errors)

    def test_mixed_case_extension_is_violation(self) -> None:
        errors = self._validate("p001", ".Png")
        assert any("uppercase_ext" in e for e in errors)

    # ── allowed-character violations ─────────────────────────────────────────

    def test_space_in_basename_is_violation(self) -> None:
        errors = self._validate("f 01", ".png")
        assert any("invalid_chars" in e for e in errors)

    def test_at_sign_in_basename_is_violation(self) -> None:
        errors = self._validate("f@01", ".png")
        assert any("invalid_chars" in e for e in errors)

    def test_slash_in_basename_is_violation(self) -> None:
        errors = self._validate("f/01", ".png")
        assert any("invalid_chars" in e for e in errors)

    def test_dot_in_basename_is_violation(self) -> None:
        # dot in the basename (not the extension dot) is disallowed
        errors = self._validate("f.01", ".png")
        assert any("invalid_chars" in e for e in errors)

    # ── extension type violations ─────────────────────────────────────────────

    def test_disallowed_extension_pdf_is_violation(self) -> None:
        errors = self._validate("f001", ".pdf")
        assert any("disallowed_ext" in e for e in errors)

    def test_disallowed_extension_jpeg_is_violation(self) -> None:
        # .jpeg is not in the allowed set; only .jpg
        errors = self._validate("f001", ".jpeg")
        assert any("disallowed_ext" in e for e in errors)

    # ── ad-blocker avoidance ─────────────────────────────────────────────────

    def test_basename_containing_ad_is_violation(self) -> None:
        errors = self._validate("fad01", ".png")
        assert any("ad_substring" in e for e in errors)

    def test_basename_ad_prefix_is_violation(self) -> None:
        errors = self._validate("addr", ".png")
        assert any("ad_substring" in e for e in errors)

    def test_basename_pad_is_violation(self) -> None:
        # "pad" contains "ad"
        errors = self._validate("pad", ".png")
        assert any("ad_substring" in e for e in errors)

    def test_basename_without_ad_passes(self) -> None:
        assert self._validate("f045", ".png") == []

    # ── multiple violations reported ─────────────────────────────────────────

    def test_multiple_violations_all_reported(self) -> None:
        # too long + uppercase ext
        errors = self._validate("toolongbasename", ".PNG")
        assert len(errors) >= 2


# ────────────────────────────────────────────────────────────────────────────
# 2. validate_package_naming — whole-package set
# ────────────────────────────────────────────────────────────────────────────


class TestValidatePackageNaming:
    """Unit tests for validate_package_naming(names, page_order) -> list[str]."""

    def _validate(self, names: list[str], page_order: list[str] | None = None) -> list[str]:
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_package_naming

        return validate_package_naming(names, page_order=page_order)

    # ── valid sets ───────────────────────────────────────────────────────────

    def test_matched_png_txt_pair_passes(self) -> None:
        assert self._validate(["f001.png", "f001.txt"]) == []

    def test_multiple_matched_pairs_pass(self) -> None:
        assert self._validate(["f001.png", "f001.txt", "p002.png", "p002.txt"]) == []

    def test_illustration_without_txt_pair_ok(self) -> None:
        # illustrations (.jpg) don't need a .txt pair
        assert self._validate(["p001.png", "p001.txt", "images/p001_01.jpg"]) == []

    # ── missing pair violations ───────────────────────────────────────────────

    def test_png_without_txt_is_violation(self) -> None:
        errors = self._validate(["f001.png"])
        assert any("missing_txt" in e for e in errors)

    def test_txt_without_png_is_violation(self) -> None:
        errors = self._validate(["f001.txt"])
        assert any("missing_png" in e for e in errors)

    def test_mismatched_pair_basenames_is_violation(self) -> None:
        # f001.png has no f001.txt; f002.txt has no f002.png
        errors = self._validate(["f001.png", "f002.txt"])
        assert any("missing_txt" in e or "missing_png" in e for e in errors)

    # ── sort order vs page_order ──────────────────────────────────────────────

    def test_sort_matches_page_order_passes(self) -> None:
        # f001 < f002 sort-wise; page_order 0001 then 0002 → first page gets f001 → matches
        errors = self._validate(
            ["f001.png", "f001.txt", "f002.png", "f002.txt"],
            page_order=["0001", "0002"],
        )
        assert errors == []

    def test_sort_out_of_order_relative_to_page_order_is_violation(self) -> None:
        # basenames f002 < p001 lexicographically (f < p → f002 sorts first)
        # but page_order says 0002 (which has prefix p001) comes first
        # → sorted order is f002, p001 but page_order wants p001 first
        errors = self._validate(
            ["p001.png", "p001.txt", "f002.png", "f002.txt"],
            page_order=["0002", "0001"],
            # 0002 → prefix p001 (first in page_order)
            # 0001 → prefix f002 (second in page_order)
            # sorted names: f002.png < p001.png (f < p lexicographically)
            # so sorted order is [f002, p001] but page_order wants [p001, f002]
        )
        assert any("sort_order" in e for e in errors)

    def test_no_page_order_provided_no_sort_check(self) -> None:
        errors = self._validate(["f002.png", "f002.txt", "f001.png", "f001.txt"])
        assert errors == []

    # ── individual file rule propagation ─────────────────────────────────────

    def test_uppercase_ext_in_set_is_violation(self) -> None:
        errors = self._validate(["F001.PNG", "F001.TXT"])
        assert any("uppercase_ext" in e for e in errors)

    def test_ad_substring_in_set_is_violation(self) -> None:
        errors = self._validate(["fad1.png", "fad1.txt"])
        assert any("ad_substring" in e for e in errors)

    def test_basename_too_long_in_set_is_violation(self) -> None:
        long = "toolongbasename"
        errors = self._validate([f"{long}.png", f"{long}.txt"])
        assert any("basename_too_long" in e for e in errors)

    def test_empty_set_passes(self) -> None:
        assert self._validate([]) == []


# ────────────────────────────────────────────────────────────────────────────
# 3. compute_prefixes_from_runs output compliance — regression guard
#
# P1.9 NOTE: compute_prefix (v1) was deleted.  The five tests that called it
# are ported here to use compute_prefixes_from_runs via the LegacyRanges
# migration helper.  The behavioural intent is unchanged: verify that the
# prefix alphabet (f/p + digits + optional b/p/r suffix) never violates PGDP
# filename rules.
# ────────────────────────────────────────────────────────────────────────────


def _prefixes_via_runs(
    n_front: int,
    n_body: int,
    plate_idx: int | None = None,
    all_plates: bool = False,
) -> dict[int, str | None]:
    """Build prefixes using the P1.9 runs model (migration helper path)."""
    from pdomain_prep_for_pgdp.core.models import PageType
    from pdomain_prep_for_pgdp.core.numbering import Leaf, compute_prefixes_from_runs
    from pdomain_prep_for_pgdp.core.numbering_migration import (
        LegacyRanges,
        page_type_to_leaf_role,
        seed_runs_from_ranges,
    )

    total = n_front + n_body
    rg = LegacyRanges(
        proof_start_idx0=0,
        proof_end_idx0=total - 1,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=n_front - 1,
        frontmatter_page_nbr_start=1,
        bodymatter_start_idx0=n_front,
        bodymatter_end_idx0=total - 1,
        bodymatter_page_nbr_start=1,
    )

    legacy_plate = {PageType.plate_b: "b", PageType.plate_p: "p", PageType.plate_r: "r"}
    if all_plates:
        page_types = dict.fromkeys(range(total), PageType.plate_b)
    else:
        page_types = {i: (PageType.plate_b if i == plate_idx else PageType.normal) for i in range(total)}

    plate_suffixes = {s: legacy_plate[pt] for s, pt in page_types.items() if pt in legacy_plate}
    runs, assign = seed_runs_from_ranges(rg, page_types)
    leaves = [
        Leaf(scan=s, leaf_role=page_type_to_leaf_role(page_types[s])[0], run_id=assign.get(s))
        for s in range(total)
    ]
    seq_width = 4 if total > 999 else 3
    return compute_prefixes_from_runs(
        leaves,
        runs,
        proof_start=rg.proof_start_idx0,
        seq_width=seq_width,
        plate_suffixes=plate_suffixes,
    )


class TestComputePrefixCompliance:
    """Verify that compute_prefixes_from_runs never emits a prefix violating PGDP rules."""

    def test_frontmatter_prefix_f_complies(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_pgdp_filename

        prefixes = _prefixes_via_runs(n_front=10, n_body=10)
        prefix = prefixes[0]
        assert prefix is not None
        # v2 format: <seq:3><type><folio>, e.g. "000f001" — type letter 'f' is present
        assert "f" in prefix
        assert validate_pgdp_filename(prefix, ".png") == []
        assert validate_pgdp_filename(prefix, ".txt") == []

    def test_bodymatter_prefix_complies(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_pgdp_filename

        prefixes = _prefixes_via_runs(n_front=10, n_body=10)
        prefix = prefixes[10]
        assert prefix is not None
        # v2 format: <seq:3><type><folio>, e.g. "010p001" — type letter 'p' is present
        assert "p" in prefix
        assert validate_pgdp_filename(prefix, ".png") == []
        assert validate_pgdp_filename(prefix, ".txt") == []

    def test_plate_suffix_prefix_complies(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_pgdp_filename

        prefixes = _prefixes_via_runs(n_front=5, n_body=5, plate_idx=7)
        prefix = prefixes[7]
        assert prefix is not None
        # plate_b suffix is "b" → e.g. "007b"
        assert prefix.endswith("b")
        assert validate_pgdp_filename(prefix, ".png") == []

    def test_prefix_never_contains_ad_substring(self) -> None:
        """Exhaustive check: prefixes cannot produce the 'ad' substring.

        The prefix alphabet is f/p + digits 0-9 + optional suffix b/p/r.
        None of these can form 'ad'. This test validates the assertion
        for the entire practical range (pages 0-999).
        """
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_pgdp_filename

        prefixes = _prefixes_via_runs(n_front=500, n_body=500)
        for i, prefix in prefixes.items():
            if prefix is not None:
                errs = validate_pgdp_filename(prefix, ".png")
                assert errs == [], f"idx0={i} prefix {prefix!r} violates PGDP rules: {errs}"

    def test_prefix_max_length_is_within_limit(self) -> None:
        """compute_prefixes_from_runs output is always ≤8 chars."""
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import validate_pgdp_filename

        # All plate_b to hit the longest possible suffix variant
        prefixes = _prefixes_via_runs(n_front=500, n_body=500, all_plates=True)
        for prefix in prefixes.values():
            if prefix is not None:
                assert len(prefix) <= 8, f"prefix {prefix!r} is too long ({len(prefix)} chars)"
                assert validate_pgdp_filename(prefix, ".png") == []


# ────────────────────────────────────────────────────────────────────────────
# 4. build_submission_zip hard-assert on naming violations
# ────────────────────────────────────────────────────────────────────────────


class TestBuildPackageNamingAssert:
    """build_submission_zip raises PgdpNamingError when prefixes violate rules."""

    def test_valid_prefixes_do_not_raise(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = "proj-naming-valid"
        page_id = "0001"
        _make_clean_page(tmp_path, project_id, page_id)

        result = build_submission_zip(
            project_id=project_id,
            page_ids=[page_id],
            data_root=tmp_path,
            page_prefixes={page_id: "f001"},
        )
        assert zipfile.is_zipfile(io.BytesIO(result))

    def test_too_long_prefix_raises_pgdp_naming_error(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import PgdpNamingError
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = "proj-naming-toolong"
        page_id = "0001"
        _make_clean_page(tmp_path, project_id, page_id)

        with pytest.raises(PgdpNamingError, match="basename_too_long"):
            build_submission_zip(
                project_id=project_id,
                page_ids=[page_id],
                data_root=tmp_path,
                page_prefixes={page_id: "toolongbasename"},
            )

    def test_ad_substring_prefix_raises_pgdp_naming_error(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import PgdpNamingError
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = "proj-naming-ad"
        page_id = "0001"
        _make_clean_page(tmp_path, project_id, page_id)

        with pytest.raises(PgdpNamingError, match="ad_substring"):
            build_submission_zip(
                project_id=project_id,
                page_ids=[page_id],
                data_root=tmp_path,
                page_prefixes={page_id: "fad01"},
            )

    def test_sort_order_violation_raises_pgdp_naming_error(self, tmp_path: Path) -> None:
        """Sort order mismatch raises PgdpNamingError with sort_order code."""
        from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import PgdpNamingError
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = "proj-naming-sort"
        page_ids = ["0001", "0002"]
        for pid in page_ids:
            _make_clean_page(tmp_path, project_id, pid)

        # page_order: 0002 first, 0001 second
        # prefixes: 0001 → "f001" (sorts first), 0002 → "p001" (sorts second)
        # sorted(["f001.png","f001.txt","p001.png","p001.txt"]) = f001 first
        # but page_order says prefix for 0002 ("p001") should be first → mismatch
        with pytest.raises(PgdpNamingError, match="sort_order"):
            build_submission_zip(
                project_id=project_id,
                page_ids=["0002", "0001"],  # page_order: 0002 first
                data_root=tmp_path,
                page_prefixes={"0001": "f001", "0002": "p001"},
            )

    def test_no_prefix_mapping_skips_naming_assert(self, tmp_path: Path) -> None:
        """When page_prefixes=None, no naming assert is performed (legacy path)."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

        project_id = "proj-naming-none"
        page_id = "0001"
        _make_clean_page(tmp_path, project_id, page_id)

        # Should not raise even with page_id as-is (which might not be PGDP-compliant)
        result = build_submission_zip(
            project_id=project_id,
            page_ids=[page_id],
            data_root=tmp_path,
            page_prefixes=None,
        )
        assert isinstance(result, bytes)


# ────────────────────────────────────────────────────────────────────────────
# 5. validation stage PGDP naming rules as blockers
# ────────────────────────────────────────────────────────────────────────────


class TestValidationStageNamingBlockers:
    """When page_prefixes violate PGDP rules, validate_project produces blockers."""

    def _make_clean_text_review(self, tmp_path: Path, project_id: str, page_id: str) -> None:
        stages = tmp_path / "projects" / project_id / "pages" / page_id / "stages"
        txt_dir = stages / "text_review"
        txt_dir.mkdir(parents=True, exist_ok=True)
        (txt_dir / "output.txt").write_text("text\n", encoding="utf-8")
        (txt_dir / "attestation.json").write_bytes(json.dumps({"status": "clean"}).encode())

    def test_validate_project_with_valid_prefixes_no_blocker(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = "proj-valstage-ok"
        page_ids = ["0001", "0002"]
        for pid in page_ids:
            self._make_clean_text_review(tmp_path, project_id, pid)

        result = validate_project(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            page_prefixes={"0001": "f001", "0002": "p002"},
        )
        assert result["passed"] is True
        assert result["blocker_count"] == 0

    def test_validate_project_with_invalid_prefix_produces_blocker(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = "proj-valstage-bad"
        page_ids = ["0001"]
        self._make_clean_text_review(tmp_path, project_id, "0001")

        result = validate_project(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            page_prefixes={"0001": "toolongprefix"},
        )
        # "toolongprefix" = 14 chars → basename_too_long blocker
        assert result["passed"] is False
        assert any("pgdp_naming" in b["code"] for b in result["blockers"])

    def test_validate_project_without_prefixes_skips_naming_check(self, tmp_path: Path) -> None:
        """When page_prefixes is None, no naming blockers are added."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = "proj-valstage-nopfx"
        page_ids = ["0001"]
        self._make_clean_text_review(tmp_path, project_id, "0001")

        result = validate_project(
            project_id=project_id,
            page_ids=page_ids,
            data_root=tmp_path,
            page_prefixes=None,
        )
        assert result["passed"] is True
        assert not any("pgdp_naming" in b.get("code", "") for b in result["blockers"])

    def test_validate_project_signature_accepts_page_prefixes_kwarg(self, tmp_path: Path) -> None:
        """validate_project accepts page_prefixes keyword argument (API contract)."""
        from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validate_project

        project_id = "proj-valstage-sig"
        # No pages — just verify the call doesn't raise TypeError
        result = validate_project(
            project_id=project_id,
            page_ids=[],
            data_root=tmp_path,
            page_prefixes={},
        )
        assert "passed" in result
