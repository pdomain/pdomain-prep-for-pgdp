from pdomain_prep_for_pgdp.core.models import LeafRole, NumberingRun, RunStyle, StartMode
from pdomain_prep_for_pgdp.core.numbering import Leaf, compute_labels


def _leaf(scan, role, run_id):
    return Leaf(scan=scan, leaf_role=role, run_id=run_id)


def test_text_run_arabic_numbers_sequentially():
    run = NumberingRun(
        id="body", style=RunStyle.arabic, start_mode=StartMode.set, start=1, step=1, role=LeafRole.text
    )
    leaves = [
        _leaf(0, LeafRole.text, "body"),
        _leaf(1, LeafRole.text, "body"),
        _leaf(2, LeafRole.text, "body"),
    ]
    assert compute_labels(leaves, [run]) == {0: "1", 1: "2", 2: "3"}


def test_counted_blank_consumes_a_number_marker_does_not():
    run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
    leaves = [
        _leaf(0, LeafRole.text, "body"),  # 1
        _leaf(1, LeafRole.blank, "body"),  # counted -> 2
        _leaf(2, LeafRole.blank, None),  # marker -> [Blank Page], no number
        _leaf(3, LeafRole.text, "body"),  # 3 (marker did NOT consume)
    ]
    labels = compute_labels(leaves, [run])
    assert labels[0] == "1"
    assert labels[1] == "2"
    assert labels[2] == "[Blank Page]"
    assert labels[3] == "3"


def test_plate_is_unnumbered():
    run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
    leaves = [
        _leaf(0, LeafRole.text, "body"),
        _leaf(1, LeafRole.plate, None),
        _leaf(2, LeafRole.text, "body"),
    ]
    labels = compute_labels(leaves, [run])
    assert labels[1] == "—"
    assert labels[2] == "2"  # plate did not consume the count


def test_roman_lower_style():
    run = NumberingRun(id="front", style=RunStyle.roman_lower, start=1, step=1, role=LeafRole.text)
    leaves = [_leaf(0, LeafRole.text, "front"), _leaf(1, LeafRole.text, "front")]
    assert compute_labels(leaves, [run]) == {0: "i", 1: "ii"}


def test_continue_run_picks_up_prior_last_number():
    body = NumberingRun(
        id="body", style=RunStyle.arabic, start_mode=StartMode.set, start=1, step=1, role=LeafRole.text
    )
    appendix = NumberingRun(
        id="appendix",
        style=RunStyle.arabic,
        start_mode=StartMode.continue_,
        start=1,
        step=1,
        role=LeafRole.text,
    )
    leaves = [
        _leaf(0, LeafRole.text, "body"),  # 1
        _leaf(1, LeafRole.text, "body"),  # 2
        _leaf(2, LeafRole.text, "appendix"),  # continues -> 3
    ]
    assert compute_labels(leaves, [body, appendix]) == {0: "1", 1: "2", 2: "3"}


def test_roman_upper_style():
    run = NumberingRun(id="front", style=RunStyle.roman_upper, start=1, step=1, role=LeafRole.text)
    leaves = [_leaf(0, LeafRole.text, "front"), _leaf(1, LeafRole.text, "front")]
    assert compute_labels(leaves, [run]) == {0: "I", 1: "II"}


def test_alpha_style():
    run = NumberingRun(id="appendix", style=RunStyle.alpha, start=1, step=1, role=LeafRole.text)
    leaves = [_leaf(0, LeafRole.text, "appendix"), _leaf(1, LeafRole.text, "appendix")]
    assert compute_labels(leaves, [run]) == {0: "A", 1: "B"}


def test_none_style_is_unnumbered():
    run = NumberingRun(id="cover", style=RunStyle.none, start=1, step=1, role=LeafRole.text)
    leaves = [_leaf(0, LeafRole.text, "cover")]
    assert compute_labels(leaves, [run]) == {0: "—"}
