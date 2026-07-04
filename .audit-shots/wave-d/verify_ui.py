"""Wave-D UI verification script."""

from __future__ import annotations

import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:43623"
PID = "45fb638296fd4efab738be889474e220"
OUT = Path("/workspaces/ocr-container/pdomain-prep-for-pgdp/.audit-shots/wave-d")
OUT.mkdir(exist_ok=True)

ARGS = [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-software-rasterizer",
    "--in-process-gpu",
    "--disable-features=Vulkan",
]
NO_ANIM = "*{animation-duration:0s!important;transition-duration:0s!important;}"

results = {}


def shot(page, name: str, full_page: bool = True) -> str:
    path = str(OUT / f"{name}.png")
    try:
        page.add_style_tag(content=NO_ANIM)
    except Exception:
        pass
    try:
        page.screenshot(path=path, full_page=full_page, timeout=20000, animations="disabled")
        return f"OK:{path}"
    except Exception as e:
        return f"FAIL:{e}"


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=ARGS, chromium_sandbox=False)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.set_default_timeout(15000)

        # L1: Projects list shows real project with non-fake progress
        print("\n=== L1: Projects list ===")
        page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=30000)
        time.sleep(2.5)
        results["L1_screenshot"] = shot(page, "L1_projects_list")
        # Check for project name in page content
        content = page.content()
        has_project = "Survivals" in content or "survivals" in content.lower() or PID in content
        print(f"  Page has 'Survivals': {has_project}")
        results["L1_has_project"] = has_project
        # Check for fake/placeholder data patterns
        has_fake = "Lorem ipsum" in content or "placeholder" in content.lower()
        print(f"  Page has fake placeholders: {has_fake}")
        results["L1_no_fake"] = not has_fake

        # L2: Dead-end nav buttons disabled
        print("\n=== L2: Dead-end nav (activity/export) disabled ===")
        page.goto(f"{BASE}/projects/{PID}", wait_until="domcontentloaded", timeout=30000)
        time.sleep(2.5)
        results["L2_configure_screenshot"] = shot(page, "L2_configure")

        # Check if activity/export buttons exist and their state
        for label in ["Activity", "Export", "Share", "Submit"]:
            btns = page.locator(f'button:has-text("{label}"), a:has-text("{label}")')
            cnt = btns.count()
            if cnt > 0:
                btn = btns.first
                disabled = (
                    btn.get_attribute("disabled") is not None or btn.get_attribute("aria-disabled") == "true"
                )
                visible = btn.is_visible()
                print(f"  '{label}' button: count={cnt}, visible={visible}, disabled={disabled}")
                results[f"L2_{label.lower()}_found"] = True
                results[f"L2_{label.lower()}_disabled"] = disabled
            else:
                print(f"  '{label}' button: not found")
                results[f"L2_{label.lower()}_found"] = False

        # S1: Source/Files grid shows real thumbnails
        print("\n=== S1: Source Files grid thumbnails ===")
        page.goto(
            f"{BASE}/projects/{PID}/pipeline?stage=source", wait_until="domcontentloaded", timeout=30000
        )
        time.sleep(2)
        # Click Files tab
        for sel in ('button:has-text("Files")', '[role=tab]:has-text("Files")'):
            try:
                btn = page.locator(sel).first
                if btn.count() and btn.is_visible():
                    btn.click()
                    print(f"  Clicked 'Files' tab via: {sel}")
                    break
            except Exception:
                pass
        time.sleep(2.5)
        results["S1_source_screenshot"] = shot(page, "S1_source_files")
        # Check for real image content (img tags with src)
        imgs = page.locator("img")
        img_count = imgs.count()
        imgs_with_src = 0
        for i in range(min(img_count, 10)):
            try:
                src = imgs.nth(i).get_attribute("src") or ""
                if src and src != "" and "data:" not in src[:10]:
                    imgs_with_src += 1
            except Exception:
                pass
        print(f"  Images found: {img_count}, with real src: {imgs_with_src}")
        results["S1_img_count"] = img_count
        results["S1_imgs_with_src"] = imgs_with_src

        # S2: Reload Files grid and check cover chip
        print("\n=== S2: Reload source Files grid, check cover chip ===")
        page.goto(
            f"{BASE}/projects/{PID}/pipeline?stage=source", wait_until="domcontentloaded", timeout=30000
        )
        time.sleep(2)
        for sel in ('button:has-text("Files")', '[role=tab]:has-text("Files")'):
            try:
                btn = page.locator(sel).first
                if btn.count() and btn.is_visible():
                    btn.click()
                    break
            except Exception:
                pass
        time.sleep(2.5)
        results["S2_reload_screenshot"] = shot(page, "S2_source_files_after_cover")
        content = page.content()
        # Look for "cover" chip/badge indicator
        has_cover = "cover" in content.lower() or "Cover" in content
        print(f"  'cover' in page content: {has_cover}")
        results["S2_cover_visible"] = has_cover

        # G2: Grayscale workbench UI
        print("\n=== G2: Grayscale workbench ===")
        page.goto(
            f"{BASE}/projects/{PID}/pipeline?stage=grayscale", wait_until="domcontentloaded", timeout=30000
        )
        time.sleep(2)
        # Click "Page workbench" tab
        for sel in (
            'button:has-text("Page workbench")',
            '[role=tab]:has-text("Page workbench")',
            'button:has-text("Workbench")',
        ):
            try:
                btn = page.locator(sel).first
                if btn.count() and btn.is_visible():
                    btn.click()
                    print(f"  Clicked tab: {sel}")
                    break
            except Exception:
                pass
        time.sleep(2)
        # Select a page - try page 11 (idx0=10 is idx 11 in 1-based UI)
        for txt in ("0010", "011", "10"):
            for sel in (
                f'[data-testid*="page"]:has-text("{txt}")',
                f'button:has-text("{txt}")',
                f'li:has-text("{txt}")',
                f'[role=button]:has-text("{txt}")',
            ):
                try:
                    el = page.locator(sel).first
                    if el.count() and el.is_visible():
                        el.click()
                        print(f"  Selected page via '{txt}': {sel}")
                        break
                except Exception:
                    pass
        time.sleep(2)
        results["G2_workbench_screenshot"] = shot(page, "G2_grayscale_workbench")
        content = page.content()
        # Check for image display (the workbench should show a processed image)
        has_canvas_or_img = "canvas" in content.lower() or (
            "<img" in content and "grayscale" in content.lower()
        )
        print(f"  Has canvas/img: {has_canvas_or_img}")
        results["G2_has_image"] = has_canvas_or_img

        # G3: Check if run buttons are enabled
        print("\n=== G3: Run button state ===")
        run_btns = page.locator('button:has-text("Run"), button:has-text("Re-run"), button:has-text("Apply")')
        run_count = run_btns.count()
        print(f"  Run/Re-run/Apply buttons found: {run_count}")
        results["G3_run_button_count"] = run_count
        if run_count > 0:
            btn = run_btns.first
            disabled = btn.get_attribute("disabled") is not None
            aria_disabled = btn.get_attribute("aria-disabled") == "true"
            print(f"  First run button disabled attr: {disabled}, aria-disabled: {aria_disabled}")
            results["G3_run_enabled"] = not disabled and not aria_disabled
        else:
            results["G3_run_enabled"] = False

        # G4: Auto recommendation shown in UI
        print("\n=== G4: Grayscale auto detect UI ===")
        # Look for recommend/detect button or displayed mode
        detect_btns = page.locator(
            'button:has-text("Detect"), button:has-text("Auto"), button:has-text("Recommend")'
        )
        print(f"  Detect/Auto buttons: {detect_btns.count()}")
        content = page.content()
        # Check for mode display
        has_mode_text = "standard" in content.lower() or "perceptual" in content.lower()
        print(f"  Mode text in UI: {has_mode_text}")
        results["G4_detect_buttons"] = detect_btns.count()
        results["G4_mode_shown"] = has_mode_text
        results["G4_screenshot"] = shot(page, "G4_grayscale_overview")

        browser.close()

    # Print summary
    print("\n\n=== RESULTS SUMMARY ===")
    for k, v in results.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
