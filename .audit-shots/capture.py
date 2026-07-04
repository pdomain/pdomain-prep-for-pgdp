"""Visual-audit capture: screenshot each app surface for canvas comparison."""

from __future__ import annotations

import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:43623"
PID = "45fb638296fd4efab738be889474e220"
PAGE = "100"  # the content page we ran the full chain on
OUT = Path("/workspaces/ocr-container/pdomain-prep-for-pgdp/.audit-shots")

# (filename, url, target_tab_label or None, select_page_100)
SURFACES = [
    ("01-projects-list", f"{BASE}/", None, False),
    ("02-jobs", f"{BASE}/jobs", None, False),
    ("03-settings", f"{BASE}/settings", None, False),
    ("04-configure", f"{BASE}/projects/{PID}", None, False),
    ("05-pipeline-shell", f"{BASE}/projects/{PID}/pipeline?stage=grayscale", "Overview", False),
    ("06-source", f"{BASE}/projects/{PID}/pipeline?stage=source", "Files", False),
    ("07-grayscale", f"{BASE}/projects/{PID}/pipeline?stage=grayscale", "Page workbench", True),
    ("08-crop", f"{BASE}/projects/{PID}/pipeline?stage=crop", "Pages", True),
    ("09-deskew-imgreview", f"{BASE}/projects/{PID}/pipeline?stage=deskew", "Page workbench", True),
    ("10-text_zones", f"{BASE}/projects/{PID}/pipeline?stage=text_zones", "Page workbench", True),
    ("11-canvas_map", f"{BASE}/projects/{PID}/pipeline?stage=canvas_map", "Facing pages", False),
    ("12-ocr-recognition", f"{BASE}/projects/{PID}/pipeline?stage=ocr", "Recognition", True),
    ("13-page_order", f"{BASE}/projects/{PID}/pipeline?stage=page_order", "Sequence", False),
    ("14-wordcheck", f"{BASE}/projects/{PID}/pipeline?stage=wordcheck", "Suspects", True),
    ("15-hyphen_join", f"{BASE}/projects/{PID}/pipeline?stage=hyphen_join", "Undecided", True),
    ("16-regex", f"{BASE}/projects/{PID}/pipeline?stage=regex", "Rules", True),
    ("17-text_review", f"{BASE}/projects/{PID}/pipeline?stage=text_review", "Review queue", True),
    ("18-illustrations", f"{BASE}/projects/{PID}/pipeline?stage=illustrations", "Illustrations", False),
    ("19-validation", f"{BASE}/projects/{PID}/pipeline?stage=validation", "Overview", False),
    ("20-build_package", f"{BASE}/projects/{PID}/pipeline?stage=build_package", "Manifest", False),
]

NO_ANIM = "*{animation-duration:0s!important;transition-duration:0s!important;}"


def click_tab(page, label: str) -> str:
    for sel in (f'button:has-text("{label}")', f'[role=tab]:has-text("{label}")'):
        try:
            btn = page.locator(sel).first
            if btn.count() and btn.is_visible():
                btn.click(timeout=3000)
                return f"clicked '{label}'"
        except Exception:  # noqa: BLE001
            pass
    return f"tab '{label}' not found"


def select_page(page) -> str:
    # Best-effort: click a page item referencing page 100 / 0100 / "101" (1-based label)
    for txt in ("0100", "101", "100"):
        for sel in (
            f'[data-testid*="page"]:has-text("{txt}")',
            f'button:has-text("{txt}")',
            f'[role=button]:has-text("{txt}")',
            f'li:has-text("{txt}")',
            f'img[alt*="{txt}"]',
        ):
            try:
                el = page.locator(sel).first
                if el.count() and el.is_visible():
                    el.click(timeout=2000)
                    return f"selected page via '{txt}'"
            except Exception:
                pass
    return "page-select: none matched"


def main() -> None:
    args = [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--in-process-gpu",
        "--disable-features=Vulkan",
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch(args=args, chromium_sandbox=False)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = ctx.new_page()
        page.set_default_timeout(12000)
        for name, url, tab, do_page in SURFACES:
            note = []
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
            except Exception as e:  # noqa: BLE001
                note.append(f"goto-err:{str(e)[:50]}")
            time.sleep(2.0)  # let React render + first data settle
            try:
                page.add_style_tag(content=NO_ANIM)
            except Exception:  # noqa: BLE001
                pass
            if tab:
                note.append(click_tab(page, tab))
                time.sleep(1.0)
            if do_page:
                note.append(select_page(page))
                time.sleep(1.5)
            try:
                page.screenshot(
                    path=str(OUT / f"{name}.png"), full_page=True, timeout=25000, animations="disabled"
                )
                note.append("shot-ok")
            except Exception:  # noqa: BLE001
                try:
                    page.screenshot(path=str(OUT / f"{name}.png"), timeout=15000, animations="disabled")
                    note.append("shot-viewport-only")
                except Exception as e2:  # noqa: BLE001
                    note.append(f"shot-FAIL:{str(e2)[:50]}")
            print(f"{name:24s} | {' | '.join(note)}", flush=True)
        browser.close()


if __name__ == "__main__":
    main()
