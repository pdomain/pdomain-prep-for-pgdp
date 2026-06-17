from pdomain_prep_for_pgdp.core.models import LeafRole
from pdomain_prep_for_pgdp.core.numbering import Leaf, reconcile


def _leaf(scan, role, run_id, ocr=None):
    return Leaf(scan=scan, leaf_role=role, run_id=run_id, ocr_folio=ocr)


def test_duplicate_label_flagged():
    labels = {0: "1", 1: "1"}
    leaves = [_leaf(0, LeafRole.text, "b"), _leaf(1, LeafRole.text, "b")]
    flags = reconcile(labels, leaves)
    assert "duplicate" in flags[1]
    assert "duplicate" not in flags[0]


def test_ocr_mismatch_flagged_out_of_sequence():
    labels = {0: "1"}
    leaves = [_leaf(0, LeafRole.text, "b", ocr="7")]
    assert "out_of_sequence" in reconcile(labels, leaves)[0]


def test_marker_not_flagged():
    labels = {0: "[Blank Page]"}
    leaves = [_leaf(0, LeafRole.blank, None)]
    assert reconcile(labels, leaves)[0] == []
