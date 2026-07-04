"""Render each design canvas (index.html) and screenshot it."""

from __future__ import annotations

import time
from pathlib import Path

from playwright.sync_api import sync_playwright

SRV = "http://127.0.0.1:8099/final"
OUT = Path("/workspaces/ocr-container/pdomain-prep-for-pgdp/.audit-shots")
ARGS = [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-software-rasterizer",
    "--in-process-gpu",
    "--disable-features=Vulkan",
]

# (outname, design_dir) — paired with the app surface numbering
DIRS = [
    ("D01-projects", "projects"),
    ("D04-configure", "projects"),
    ("D05-pipeline", "pipeline"),
    ("D06-source", "source"),
    ("D07-grayscale", "grayscale"),
    ("D08-crop", "crop"),
    ("D09-deskew", "deskew"),
    ("D10-text_zones", "text_zones"),
    ("D11-canvas_map", "canvas_map"),
    ("D12-ocr", "ocr"),
    ("D13-page_order", "page_order"),
    ("D15-hyphen_join", "hyphen_join"),
    ("D16-regex", "regex"),
    ("D17-text_review", "text_review"),
    ("D18-illustrations", "illustrations"),
    ("D19-validation", "validation"),
    ("D20-build_package", "build_package"),
    ("D-threshold", "threshold"),
]


def main() -> None:
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS, chromium_sandbox=False)
        ctx = b.new_context(viewport={"width": 1600, "height": 1100})
        page = ctx.new_page()
        for name, d in DIRS:
            note = []
            try:
                page.goto(f"{SRV}/{d}/index.html", wait_until="domcontentloaded", timeout=30000)
                time.sleep(6.5)  # babel compile + render
                tlen = page.evaluate("document.getElementById('root')?.innerText?.length || 0")
                note.append(f"textlen={tlen}")
                page.screenshot(
                    path=str(OUT / f"{name}.png"), full_page=True, timeout=25000, animations="disabled"
                )
                note.append("ok")
            except Exception as e:  # noqa: BLE001
                note.append(f"ERR:{str(e)[:50]}")
            print(f"{name:22s} | {' | '.join(note)}", flush=True)
        b.close()


if __name__ == "__main__":
    main()
