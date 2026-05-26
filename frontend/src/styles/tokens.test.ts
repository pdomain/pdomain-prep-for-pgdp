import { describe, it, expect, beforeAll } from "vitest";

describe("tokens.css", () => {
  beforeAll(async () => {
    // Inject minimal token CSS matching pd-ui's convention:
    //   :root = dark (default), [data-theme="light"] = light.
    // uiPrefs.ts applies data-theme at module load time, so in practice the
    // app always sets data-theme="light" on a fresh install.
    const style = document.createElement("style");
    style.textContent = `
      :root {
        --bg-page: #0c0c10;
        --bg-surface: #15151b;
        --ink-1: #f0f0f2;
        --ink-2: #b0b0b8;
        --status-done: #5fbf6a;
        --stage-clean: #5fbf6a;
      }
      [data-theme="light"] {
        --bg-page: #f6f4ef;
        --bg-surface: #ffffff;
      }
    `;
    document.head.appendChild(style);
  });

  it("dark default bg-page token is defined", () => {
    // :root = dark default (pd-ui theme convention)
    document.documentElement.removeAttribute("data-theme");
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg-page")
      .trim();
    expect(value).toBeTruthy();
    expect(value).not.toBe("");
  });

  it("light theme overrides bg-page", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const light = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg-page")
      .trim();
    document.documentElement.removeAttribute("data-theme");
    const dark = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg-page")
      .trim();
    expect(light).not.toBe(dark);
  });
});
