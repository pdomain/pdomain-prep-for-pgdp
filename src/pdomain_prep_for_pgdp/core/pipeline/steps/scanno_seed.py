"""Licence-clean scanno seed from pptext.

The word list is the MIT-licensed ``scannos.txt`` shipped by
Distributed Proofreaders' pptext (copyright 2018). The permission
notice below is required for this copy.

MIT License

Copyright (c) 2018

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Source: https://github.com/DistributedProofreaders/pptext/blob/master/scannos.txt
pptext matches these words case-insensitively and flags them. It does not
rewrite the page. This module expands each entry to lower, title, and upper
case so the case-sensitive wordcheck matcher sees the same hits.
"""

from __future__ import annotations

# Exact lines of pptext scannos.txt, including the numeric entry "11".
_PPTEXT_SCANNOS: tuple[str, ...] = (
    "11",
    "ail",
    "arc",
    "arid",
    "bad",
    "bade",
    "ball",
    "band",
    "bar",
    "bat",
    "bead",
    "beads",
    "bear",
    "bis",
    "bit",
    "bo",
    "boon",
    "borne",
    "bow",
    "bumbled",
    "car",
    "carnage",
    "carne",
    "cast",
    "cat",
    "cheek",
    "clay",
    "coining",
    "com",
    "comer",
    "die",
    "docs",
    "ease",
    "fail",
    "fee",
    "fie",
    "hack",
    "haying",
    "hi",
    "ho",
    "hut",
    "lie",
    "lime",
    "loth",
    "modem",
    "Ms",
    "ray",
    "ringer",
    "ringers",
    "rioted",
    "tho",
    "tie",
    "tier",
    "tight",
    "tile",
    "tiling",
    "tinder",
    "tip",
    "tom",
    "tor",
    "tram",
    "tune",
    "wen",
    "yon",
)


def _case_variants(word: str) -> set[str]:
    """Lower, title, and upper forms, plus the file's own spelling."""
    variants = {word}
    if not word:
        return variants
    lowered = word.casefold()
    variants.add(lowered)
    variants.add(lowered.upper())
    variants.add(lowered[0].upper() + lowered[1:])
    return variants


def pptext_scanno_words() -> frozenset[str]:
    """Return the pptext stealth-scanno seed, with case variants."""
    words: set[str] = set()
    for word in _PPTEXT_SCANNOS:
        words.update(_case_variants(word))
    return frozenset(words)
