# Grayscale Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-algorithm grayscale stage with a composable `flatten? → converter → CLAHE?` pipeline that runs on CPU or GPU (auto-selected), is tuned via the shared 3-tier settings (page/project/all), and has an Auto detector that recommends the whole pipeline per book.

**Architecture:** Image ops live in `pdomain-book-tools` with matching CPU (numpy/cv2) and GPU (CuPy) implementations behind one `run_grayscale_pipeline(img, config, use_gpu)` entry point. `pdomain-prep-for-pgdp`'s grayscale stage builds a `GrayscaleConfig` from resolved 3-tier settings and calls that entry point; the GPU stage impl is registered and the `"gpu"`/`"cuda"` dispatch-key bug is fixed. The detect endpoint becomes a whole-pipeline recommender. The frontend grayscale panel becomes a pipeline editor showing the resolved value and its source tier.

**Tech Stack:** Python 3.13, numpy, OpenCV (`cv2`), CuPy (`cupyx.scipy.ndimage`), pytest, FastAPI, event-sourced dual-write; React 19 + Vite + TS + XState v5; pdomain-ops prefs.

**Spec:** `docs/specs/2026-06-15-grayscale-pipeline.md`. **3-tier settings** already shipped (commit `9df1101`, branch `feat/3tier-stage-settings`) — M3 builds on it.

---

## File Structure

### pdomain-book-tools (new subpackage)

- Create `pdomain_book_tools/image_processing/grayscale_pipeline/__init__.py` — public exports.
- Create `.../grayscale_pipeline/config.py` — `GrayscaleConfig` dataclass + `Converter` enum (pure, no cv2/cupy import).
- Create `.../grayscale_pipeline/ops_cpu.py` — CPU ops: flatten, luma, lab_l, best_channel, clahe.
- Create `.../grayscale_pipeline/color2gray_cpu.py` — CPU port of `cupy_color_to_gray`.
- Create `.../grayscale_pipeline/ops_gpu.py` — CuPy ops: flatten, luma, lab_l, best_channel, clahe (Color2Gray GPU = existing `cupy_color_to_gray`).
- Create `.../grayscale_pipeline/pipeline.py` — `run_grayscale_pipeline(img, config, *, use_gpu)` orchestrator.
- Tests under `tests/image_processing/grayscale_pipeline/`.
- Existing (reuse): `cupy_processing/color_to_gray.py` (`cupy_color_to_gray`, `np_uint8_color_to_gray`), `image_processing/gpu.py` (`require_cupy`, availability check).

### pdomain-prep-for-pgdp

- Modify `src/pdomain_prep_for_pgdp/core/models.py` — add nested `GrayscaleConfig` to `ResolvedPageConfig`.
- Modify `core/pipeline/stage_settings.py` — `STAGE_SETTINGS_DEFAULTS["grayscale"]` = pipeline default; map nested settings.
- Modify `core/pipeline/stage_registry.py` — grayscale CPU + GPU impls call `run_grayscale_pipeline`; register GPU impl; fix dispatch key.
- Modify `api/data/project_stages.py` — `detect_grayscale_profile` → whole-pipeline recommender.
- Modify `core/pipeline/stage_settings.py` AppWide tier — switch `all` storage to pdomain-ops prefs.
- Frontend: `frontend/src/pages/pipeline/tools/grayscale/*`, `machines/tools/grayscaleTool.ts`, `services/tools/grayscaleTool.ts`, `types`.
- Tests: `tests/test_grayscale_pipeline_*.py`, `tests/e2e/test_grayscale_browser.py`.

---

## Milestone 0 — book-tools: pipeline config + CPU ops (parity foundation)

Work in a book-tools worktree. `pdomain-book-tools` is basedpyright-strict + ruff; run `make format` then `make ci AI=1`.

### Task 0.1: GrayscaleConfig + Converter enum

**Files:**
- Create: `pdomain_book_tools/image_processing/grayscale_pipeline/config.py`
- Test: `tests/image_processing/grayscale_pipeline/test_config.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/image_processing/grayscale_pipeline/test_config.py
from pdomain_book_tools.image_processing.grayscale_pipeline.config import (
    Converter, FlattenConfig, ClaheConfig, GrayscaleConfig,
)

def test_default_config_is_plain_luma():
    cfg = GrayscaleConfig()
    assert cfg.converter is Converter.luma
    assert cfg.flatten.enabled is False
    assert cfg.clahe.enabled is False
    assert cfg.output_range is None

def test_config_roundtrips_through_dict():
    cfg = GrayscaleConfig(
        flatten=FlattenConfig(enabled=True, radius=64, strength=1.0),
        converter=Converter.best_channel,
        channel="green",
        clahe=ClaheConfig(enabled=True, clip_limit=2.0, tile_grid=8),
    )
    assert GrayscaleConfig.from_dict(cfg.to_dict()) == cfg

def test_from_dict_rejects_unknown_converter():
    import pytest
    with pytest.raises(ValueError):
        GrayscaleConfig.from_dict({"converter": "bogus"})
```

- [ ] **Step 2: Run test to verify it fails** — `cd <book-tools-worktree> && uv run pytest tests/image_processing/grayscale_pipeline/test_config.py -v` → FAIL (module missing).

- [ ] **Step 3: Write minimal implementation**

```python
# pdomain_book_tools/image_processing/grayscale_pipeline/config.py
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Literal

class Converter(str, Enum):
    luma = "luma"            # BT.601 weighted luma (standard default)
    luma_bt709 = "luma_bt709"  # exact-continuity for old mode=perceptual
    lab_l = "lab_l"          # CIELAB L*
    color2gray = "color2gray"  # contrast-preserving (CuPy + CPU port)
    best_channel = "best_channel"  # green / red / blue / auto

@dataclass(frozen=True)
class FlattenConfig:
    enabled: bool = False
    radius: int = 64
    strength: float = 1.0

@dataclass(frozen=True)
class ClaheConfig:
    enabled: bool = False
    clip_limit: float = 2.0
    tile_grid: int = 8

@dataclass(frozen=True)
class Color2GrayParams:
    radius: int = 300
    samples: int = 4
    iterations: int = 10
    enhance_shadows: bool = False

@dataclass(frozen=True)
class GrayscaleConfig:
    flatten: FlattenConfig = field(default_factory=FlattenConfig)
    converter: Converter = Converter.luma
    channel: Literal["green", "red", "blue", "auto"] = "green"
    color2gray: Color2GrayParams = field(default_factory=Color2GrayParams)
    clahe: ClaheConfig = field(default_factory=ClaheConfig)
    output_range: tuple[int, int] | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["converter"] = self.converter.value
        d["output_range"] = list(self.output_range) if self.output_range else None
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> GrayscaleConfig:
        try:
            conv = Converter(d.get("converter", "luma"))
        except ValueError as exc:
            raise ValueError(f"unknown converter: {d.get('converter')!r}") from exc
        rng = d.get("output_range")
        return cls(
            flatten=FlattenConfig(**(d.get("flatten") or {})),
            converter=conv,
            channel=d.get("channel", "green"),
            color2gray=Color2GrayParams(**(d.get("color2gray") or {})),
            clahe=ClaheConfig(**(d.get("clahe") or {})),
            output_range=(int(rng[0]), int(rng[1])) if rng else None,
        )
```

- [ ] **Step 4: Run test to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git add pdomain_book_tools/image_processing/grayscale_pipeline/config.py tests/image_processing/grayscale_pipeline/test_config.py && git commit -m "feat(grayscale-pipeline): config + converter enum"`

### Task 0.2: CPU converters — luma (BT.601 + BT.709), CIELAB L*, best_channel

**Files:**
- Create: `pdomain_book_tools/image_processing/grayscale_pipeline/ops_cpu.py`
- Test: `tests/image_processing/grayscale_pipeline/test_ops_cpu.py`

- [ ] **Step 1: Write the failing test** (asserts shape/dtype + each converter differs + best_channel picks green)

```python
# tests/image_processing/grayscale_pipeline/test_ops_cpu.py
import numpy as np
from pdomain_book_tools.image_processing.grayscale_pipeline import ops_cpu

def _img():
    rng = np.random.default_rng(7)
    return rng.integers(0, 256, size=(32, 48, 3), dtype=np.uint8)  # BGR

def test_luma_bt601_shape_dtype():
    out = ops_cpu.luma(_img(), bt709=False)
    assert out.shape == (32, 48) and out.dtype == np.uint8

def test_bt601_differs_from_bt709():
    img = _img()
    assert np.any(ops_cpu.luma(img, bt709=False) != ops_cpu.luma(img, bt709=True))

def test_lab_l_differs_from_luma():
    img = _img()
    assert np.any(ops_cpu.lab_l(img) != ops_cpu.luma(img, bt709=False))

def test_best_channel_green_returns_green():
    img = np.zeros((4, 4, 3), np.uint8); img[..., 1] = 200  # BGR green channel = index 1
    assert np.all(ops_cpu.best_channel(img, "green") == 200)

def test_best_channel_auto_picks_highest_variance():
    img = np.zeros((8, 8, 3), np.uint8)
    img[..., 0] = 100            # blue flat
    img[:, ::2, 2] = 255         # red high variance
    assert np.array_equal(ops_cpu.best_channel(img, "auto"), img[..., 2])
```

- [ ] **Step 2: Run test to verify it fails** — `uv run pytest tests/image_processing/grayscale_pipeline/test_ops_cpu.py -v` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```python
# pdomain_book_tools/image_processing/grayscale_pipeline/ops_cpu.py
from __future__ import annotations
import cv2
import numpy as np
import numpy.typing as npt

U8 = npt.NDArray[np.uint8]

def luma(img: U8, *, bt709: bool = False) -> U8:
    # img is BGR uint8. cv2 BGR2GRAY uses BT.601 (0.114B,0.587G,0.299R).
    if not bt709:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    b, g, r = img[..., 0].astype(np.float32), img[..., 1].astype(np.float32), img[..., 2].astype(np.float32)
    y = 0.0722 * b + 0.7152 * g + 0.2126 * r
    return np.clip(y, 0, 255).astype(np.uint8)

def lab_l(img: U8) -> U8:
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    return lab[..., 0]  # L channel, already 0..255 uint8

def best_channel(img: U8, channel: str = "green") -> U8:
    idx = {"blue": 0, "green": 1, "red": 2}
    if channel in idx:
        return img[..., idx[channel]].copy()
    # auto: pick channel with highest variance (proxy for text contrast)
    variances = [float(img[..., c].var()) for c in range(3)]
    return img[..., int(np.argmax(variances))].copy()
```

- [ ] **Step 4: Run test to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale-pipeline): CPU luma/lab/best_channel converters"`

### Task 0.3: CPU background-flatten + CLAHE + output-range

**Files:**
- Modify: `pdomain_book_tools/image_processing/grayscale_pipeline/ops_cpu.py`
- Test: `tests/image_processing/grayscale_pipeline/test_ops_cpu.py`

- [ ] **Step 1: Write the failing test**

```python
def test_flatten_reduces_low_frequency_gradient():
    # synthetic uneven illumination: a bright ramp across a mid-gray page
    h, w = 64, 64
    ramp = np.tile(np.linspace(60, 200, w, dtype=np.float32), (h, 1))
    img = np.stack([ramp, ramp, ramp], axis=-1).astype(np.uint8)
    flat = ops_cpu.flatten(img, radius=24, strength=1.0)
    # after flattening, the column-mean spread should shrink markedly
    before = float(img[..., 1].mean(axis=0).std())
    after = float(flat[..., 1].mean(axis=0).std())
    assert after < before * 0.5

def test_clahe_increases_local_contrast_on_faded():
    faded = (np.random.default_rng(1).integers(110, 140, size=(64, 64), dtype=np.uint8))
    out = ops_cpu.clahe(faded, clip_limit=3.0, tile_grid=8)
    assert float(out.std()) > float(faded.std())

def test_output_range_stretches():
    g = np.full((8, 8), 128, np.uint8); g[0, 0] = 100; g[0, 1] = 150
    out = ops_cpu.apply_output_range(g, (0, 255))
    assert out.min() == 0 and out.max() == 255
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement**

```python
def flatten(img: U8, *, radius: int = 64, strength: float = 1.0) -> U8:
    # blur-divide illumination normalization, per channel, on color image -> color image
    k = max(3, radius | 1)
    out = np.empty_like(img)
    for c in range(img.shape[2]):
        ch = img[..., c].astype(np.float32) + 1.0
        bg = cv2.GaussianBlur(ch, (k, k), 0) + 1.0
        norm = ch / bg * float(np.mean(bg))
        blended = (1.0 - strength) * ch + strength * norm
        out[..., c] = np.clip(blended, 0, 255).astype(np.uint8)
    return out

def clahe(gray: U8, *, clip_limit: float = 2.0, tile_grid: int = 8) -> U8:
    op = cv2.createCLAHE(clipLimit=float(clip_limit), tileGridSize=(int(tile_grid), int(tile_grid)))
    return op.apply(gray)

def apply_output_range(gray: U8, out_range: tuple[int, int]) -> U8:
    lo, hi = float(gray.min()), float(gray.max())
    if hi <= lo:
        return gray
    omin, omax = out_range
    scaled = (gray.astype(np.float32) - lo) / (hi - lo) * (omax - omin) + omin
    return np.clip(scaled, 0, 255).astype(np.uint8)
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale-pipeline): CPU flatten + CLAHE + output-range"`

### Task 0.4: CPU Color2Gray port (parity with cupy_color_to_gray)

**Files:**
- Create: `pdomain_book_tools/image_processing/grayscale_pipeline/color2gray_cpu.py`
- Test: `tests/image_processing/grayscale_pipeline/test_color2gray_cpu.py`

Read `pdomain_book_tools/image_processing/cupy_processing/color_to_gray.py` first; port the SAME math to numpy (sample `samples×iterations` neighbours within `radius`, min/max colour vectors, `num/den` ratio, optional shadow variant). Determinism: seed the RNG from a fixed seed param.

- [ ] **Step 1: Write the failing test** (deterministic output + differs from luma + GPU-parity guarded by cupy availability)

```python
# tests/image_processing/grayscale_pipeline/test_color2gray_cpu.py
import numpy as np, pytest
from pdomain_book_tools.image_processing.grayscale_pipeline.color2gray_cpu import color2gray_cpu

def _img():
    return np.random.default_rng(3).integers(0, 256, (24, 24, 3), np.uint8)

def test_returns_uint8_2d():
    out = color2gray_cpu(_img(), radius=8, samples=4, iterations=4, seed=0)
    assert out.shape == (24, 24) and out.dtype == np.uint8

def test_deterministic_with_seed():
    img = _img()
    a = color2gray_cpu(img, radius=8, samples=4, iterations=4, seed=0)
    b = color2gray_cpu(img, radius=8, samples=4, iterations=4, seed=0)
    assert np.array_equal(a, b)

def test_differs_from_bt601_luma():
    import cv2
    img = _img()
    assert np.any(color2gray_cpu(img, radius=8, samples=4, iterations=4, seed=0) != cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))

@pytest.mark.skipif(not _has_cupy(), reason="cupy not available")
def test_parity_with_gpu_within_tolerance():
    from pdomain_book_tools.image_processing.cupy_processing.color_to_gray import np_uint8_color_to_gray
    img = _img()
    cpu = color2gray_cpu(img, radius=8, samples=64, iterations=64, seed=0).astype(np.int16)
    gpu = np_uint8_color_to_gray(img, radius=8, samples=64, iterations=64).astype(np.int16)
    # high sample counts converge; allow a tolerance band on mean abs diff
    assert float(np.abs(cpu - gpu).mean()) < 12.0
```

(Define `_has_cupy()` helper importing `require_cupy` in a try/except.)

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** the numpy port mirroring `cupy_color_to_gray`'s algorithm (float32 [0,1], padded neighbour sampling with `np.roll`/gather, `num=sqrt(sum(px^2))`, `den=num+sqrt(sum((px-max)^2))`, shadow variant when `enhance_shadows`). Keep batching simple (vectorize over pixels; iterate `iterations` accumulation). Return `np.clip(ratio*255,0,255).astype(uint8)`.
- [ ] **Step 4: Run to verify pass** (parity test runs only if cupy present) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale-pipeline): CPU Color2Gray port + GPU parity test"`

### Task 0.5: GPU ops (CuPy) — luma, lab_l, best_channel, flatten, clahe

**Files:**
- Create: `pdomain_book_tools/image_processing/grayscale_pipeline/ops_gpu.py`
- Test: `tests/image_processing/grayscale_pipeline/test_ops_gpu.py` (all tests `skipif not cupy`)

- [ ] **Step 1: Write failing parity tests** — for each op, assert the GPU result equals the CPU result within tolerance on the same input (luma exact; lab_l/flatten/clahe within a small band). Example:

```python
@pytest.mark.skipif(not _has_cupy(), reason="cupy not available")
def test_gpu_luma_matches_cpu():
    import numpy as np
    from pdomain_book_tools.image_processing.grayscale_pipeline import ops_cpu, ops_gpu
    img = np.random.default_rng(5).integers(0, 256, (16, 16, 3), np.uint8)
    cpu = ops_cpu.luma(img, bt709=False).astype(np.int16)
    gpu = ops_gpu.luma_gpu(img, bt709=False).astype(np.int16)  # np-in/np-out wrapper
    assert float(np.abs(cpu - gpu).mean()) <= 1.0
```

- [ ] **Step 2: Run to verify fail** (or skip if no GPU — then run on the GPU host) → FAIL.
- [ ] **Step 3: Implement** numpy-in/numpy-out CuPy wrappers (`*_gpu`) that upload, compute with `cupy`/`cupyx.scipy.ndimage` (Gaussian for flatten; weighted sum for luma; LAB via cupy color transform or fall back to CPU lab; CLAHE: per OQ-4 may delegate to `ops_cpu.clahe` even on GPU path), download, return uint8. Each guards `require_cupy()`.
- [ ] **Step 4: Run on GPU host to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale-pipeline): GPU ops with CPU parity"`

### Task 0.6: Pipeline orchestrator + public API

**Files:**
- Create: `pdomain_book_tools/image_processing/grayscale_pipeline/pipeline.py`
- Modify: `.../grayscale_pipeline/__init__.py`
- Test: `tests/image_processing/grayscale_pipeline/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/image_processing/grayscale_pipeline/test_pipeline.py
import numpy as np
from pdomain_book_tools.image_processing.grayscale_pipeline import (
    GrayscaleConfig, Converter, FlattenConfig, ClaheConfig, run_grayscale_pipeline,
)

def _img():
    return np.random.default_rng(9).integers(0, 256, (40, 40, 3), np.uint8)

def test_default_pipeline_equals_luma():
    import cv2
    img = _img()
    out = run_grayscale_pipeline(img, GrayscaleConfig(), use_gpu=False)
    assert np.array_equal(out, cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))

def test_flatten_then_clahe_changes_output():
    img = _img()
    base = run_grayscale_pipeline(img, GrayscaleConfig(), use_gpu=False)
    cfg = GrayscaleConfig(flatten=FlattenConfig(enabled=True), clahe=ClaheConfig(enabled=True))
    assert np.any(run_grayscale_pipeline(img, cfg, use_gpu=False) != base)

def test_converter_choice_changes_output():
    img = _img()
    a = run_grayscale_pipeline(img, GrayscaleConfig(converter=Converter.luma), use_gpu=False)
    b = run_grayscale_pipeline(img, GrayscaleConfig(converter=Converter.lab_l), use_gpu=False)
    assert np.any(a != b)
```

- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** — `run_grayscale_pipeline` selects the CPU or GPU op module (use_gpu and cupy availability; else CPU), runs `flatten?(color) → converter(color)->gray → clahe?(gray) → output_range?(gray)`. Color2Gray converter dispatches to `color2gray_cpu` or `np_uint8_color_to_gray`. `__init__.py` re-exports config types + `run_grayscale_pipeline`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: `make format && make ci AI=1`** green; **commit** — `git commit -am "feat(grayscale-pipeline): orchestrator + public API"`

### Task 0.7: Release book-tools + bump prep

- [ ] **Step 1:** Update `CHANGELOG.md` with the grayscale-pipeline entry; mark next minor.
- [ ] **Step 2:** `make ci AI=1` green; ff-merge the worktree branch to book-tools `main`.
- [ ] **Step 3:** Release: `bash scripts/do-release.sh` (BUMP=minor; ci-slow preflight + tag + push + dispatch). Verify the publish workflow succeeds.
- [ ] **Step 4:** In prep, `make update-pdomain-deps`, set `pdomain-book-tools>=<new>`, `uv lock`; `make ci AI=1` green; **commit** the bump.

---

## Milestone 1 — prep backend: GrayscaleConfig + CPU stage execution

### Task 1.1: ResolvedPageConfig carries a GrayscaleConfig

**Files:**
- Modify: `src/pdomain_prep_for_pgdp/core/models.py`
- Test: `tests/test_grayscale_pipeline_config.py`

- [ ] **Step 1: Write the failing test** — assert `ResolvedPageConfig` has a `grayscale` field of the pipeline config shape with `converter="luma"` default, and a `from_settings(dict)` builder maps nested settings.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** — add a `grayscale: GrayscaleConfigModel` (pydantic mirror of book-tools `GrayscaleConfig.to_dict()` shape) defaulting to plain luma; keep the legacy flat fields readable for migration (Task 1.3).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale): ResolvedPageConfig grayscale pipeline config"`

### Task 1.2: grayscale stage CPU impl calls run_grayscale_pipeline

**Files:**
- Modify: `core/pipeline/stage_registry.py` (`_grayscale_cpu`)
- Test: `tests/test_grayscale_stage_params.py` (extend)

- [ ] **Step 1: Write the failing test** — feed `_grayscale_cpu` a color image + a `GrayscaleConfig` with `converter=best_channel, channel=green` and assert the output equals the green channel (proving config reaches the pipeline). Add a byte-diff test: two different configs → different artifacts.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** — `_grayscale_cpu(image, cfg)` builds the book-tools `GrayscaleConfig` from `cfg.grayscale` and calls `run_grayscale_pipeline(image, gcfg, use_gpu=False)`. Remove the old single `to_grayscale` call. Keep the fail-loud import guard.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale): CPU stage runs the pipeline"`

### Task 1.3: Settings defaults + migration from legacy fields

**Files:**
- Modify: `core/pipeline/stage_settings.py` (`STAGE_SETTINGS_DEFAULTS["grayscale"]`, `_SETTINGS_KEY_TO_FIELD`)
- Test: `tests/test_grayscale_pipeline_migration.py`

- [ ] **Step 1: Write the failing test** — `STAGE_SETTINGS_DEFAULTS["grayscale"]` is the pipeline default (`flatten off, converter=luma, clahe off`); a legacy `{mode:"perceptual", gamma:..}` settings dict maps to `{converter:"luma_bt709", ...}` (OQ-1 exact continuity); a legacy `{mode:"standard"}` maps to `{converter:"luma"}`.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** the default + a `migrate_grayscale_settings(dict)->dict` used on read; `apply_stage_settings_to_config` builds the nested `grayscale` config.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale): pipeline settings defaults + legacy migration"`

---

## Milestone 2 — prep backend: GPU impl + dispatch-key fix

### Task 2.1: Fix the GPU dispatch-key mismatch (gpu vs cuda)

**Files:**
- Modify: `core/pipeline/stage_registry.py` (`get_stage_impl` / `register_gpu_impls` / `_GPU_IMPL_MAP`)
- Test: `tests/test_stage_dispatch_device_key.py`

- [ ] **Step 1: Write the failing test** — `get_stage_impl(<a-gpu-capable-stage>, "cuda")` returns the GPU impl (not KeyError); `get_stage_impl(stage, "cpu")` returns CPU; an unknown device falls back to CPU.
- [ ] **Step 2: Run to verify fail** → FAIL (KeyError today).
- [ ] **Step 3: Implement** — normalize the device value to an impl key (`{"cuda":"gpu","gpu":"gpu","cpu":"cpu"}.get(device,"cpu")`) in `get_stage_impl`; CPU fallback when a stage has no GPU impl.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(dispatch): map cuda device to gpu impl key (all GPU stages)"`

### Task 2.2: Register grayscale GPU impl

**Files:**
- Modify: `core/pipeline/stage_registry.py` (`_GPU_CAPABLE_STAGE_IDS`, `_GPU_IMPL_MAP`, a `_grayscale_gpu`)
- Test: `tests/test_grayscale_stage_params.py` (GPU test `skipif not cupy`)

- [ ] **Step 1: Write the failing test** (`skipif not cupy`) — `_grayscale_gpu(image, cfg)` produces an artifact equal to `_grayscale_cpu(image, cfg)` within tolerance for `converter=luma`; grayscale is in `_GPU_CAPABLE_STAGE_IDS`.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** — `_grayscale_gpu` calls `run_grayscale_pipeline(image, gcfg, use_gpu=True)`; register under the `"gpu"` impl key; add `"grayscale"` to `_GPU_CAPABLE_STAGE_IDS`.
- [ ] **Step 4: Run on GPU host to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale): GPU stage impl on the CuPy pipeline"`

---

## Milestone 3 — settings: 3-tier wiring + app-tier to ops prefs

### Task 3.1: Switch the "all" tier from JSON file to pdomain-ops prefs

**Files:**
- Modify: `core/pipeline/stage_settings.py` (`AppWideStageSettings`)
- Test: `tests/test_3tier_stage_settings.py` (extend)

- [ ] **Step 1: Write the failing test** — writing an app-wide default for a stage and reading it back goes through `pdomain-ops prefs` (assert the prefs key is written), not a `stage_settings_all.json` file.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** — back `AppWideStageSettings` with `pd_ocr_ops` prefs read/write under a `stage_settings.<stage_id>` key; keep the JSON path as a one-time read fallback for migration.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "refactor(settings): app-wide tier via pdomain-ops prefs (OC-1)"`

### Task 3.2: End-to-end 3-tier resolution of the grayscale pipeline config

**Files:**
- Modify: `core/pipeline/stage_runner.py` (thread idx0), `apply_stage_settings_to_config`
- Test: `tests/test_grayscale_3tier_resolution.py`

- [ ] **Step 1: Write the failing test** — set an app-wide grayscale default (converter=luma), a project default (flatten on), and a page override (converter=best_channel); assert the page resolves converter=best_channel + flatten on; a different page (no override) resolves converter=luma + flatten on.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** — ensure the run path resolves `page ?? project ?? all ?? registry` field-by-field for the nested grayscale config and builds `ResolvedPageConfig.grayscale`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale): 3-tier resolution of pipeline config"`

### Task 3.3: Auto / best-default detector

**Files:**
- Modify: `api/data/project_stages.py` (`detect_grayscale_profile` → whole-pipeline)
- Test: `tests/test_grayscale_autodetect.py`

- [ ] **Step 1: Write the failing test** — given synthetic sample images (a) colorful + GPU available → `converter=color2gray`; (b) strong red/yellow cast → `converter=best_channel`; (c) flat clean gray → `converter=luma`; (d) uneven illumination ramp → `flatten.enabled=True`; (e) low-contrast faded → `clahe.enabled=True`. The endpoint returns a `GrayscaleConfig` dict + a `why` reason string. Inject GPU-availability + the sample loader so the test is deterministic.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** — sample ~8 source pages; compute chroma std, per-channel imbalance, low-frequency luminance spread, histogram/high-pass contrast; compose the config with the GPU-aware converter rule (spec §8a); return config + `why`. Keep the heuristic pure + unit-testable (separate the analysis fn from the route).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale): whole-pipeline Auto detector (GPU-aware)"`

---

## Milestone 4 — frontend: pipeline editor + tiers

### Task 4.1: Grayscale config types + service wiring

**Files:**
- Modify: `frontend/src/machines/tools/grayscaleTool.ts`, `frontend/src/services/tools/grayscaleTool.ts`, types
- Test: `frontend/src/pages/pipeline/tools/grayscale/grayscaleConfig.test.ts`

- [ ] **Step 1: Write the failing test** — a `GrayscaleConfig` TS type mirrors the backend; `draftToSettings` serializes the nested config (flatten/converter/clahe) to the PUT body shape; `settingsToDraft` reverses it. Round-trip test.
- [ ] **Step 2: Run to verify fail** — `cd frontend && pnpm test grayscaleConfig` → FAIL.
- [ ] **Step 3: Implement** the types + (de)serializers; the service `runStage`/`putStageSettings` send the nested config (snake_case keys to match the backend).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale-ui): pipeline config types + serializers"`

### Task 4.2: Pipeline editor panel (flatten / converter / CLAHE) with resolved-source display

**Files:**
- Modify: `frontend/src/pages/pipeline/tools/grayscale/GrayscaleWorkbench.tsx`, `GrayscaleSettings.tsx`
- Add `data-testid` to each control (see Task 5 contract).
- Test: `frontend/src/pages/pipeline/tools/grayscale/GrayscalePipelineEditor.test.tsx`

- [ ] **Step 1: Write the failing test** — render the editor with a resolved config; flatten toggle, converter `<select>` (luma/lab_l/color2gray/best_channel), CLAHE toggle render with their `data-testid`; selecting a converter dispatches `SET_CONVERTER`; the panel shows the resolved value + a "from: page|project|all" badge per field.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** the editor + the source-tier badge from the `/settings/resolved` response (`sources` map).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale-ui): composable pipeline editor + tier source badges"`

### Task 4.3: Per-tier save (page override / project default / Auto) + app Settings

**Files:**
- Modify: grayscale workbench actions + machine; app Settings page for the "all" tier
- Test: `frontend/src/pages/pipeline/tools/grayscale/GrayscaleTiers.test.tsx`

- [ ] **Step 1: Write the failing test** — "Save for this page" PUTs the page tier; "Save as project default" PUTs the project tier; "Auto" calls detect and applies the returned config + shows the `why`; the app Settings control PUTs the `all` tier.
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** the three save actions + the Auto button wiring + the Settings control.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(grayscale-ui): per-tier save + Auto detect"`

---

## Milestone 5 — Browser Verification (MANDATORY — FastAPI+SPA)

prep ships the SPA via `StaticFiles` + catch-all; API tests can't catch a white screen or broken pipeline editor. This milestone opens real Chromium against the running server. Reference: `pdomain-ocr-simple-gui/tests/e2e/`.

### Task 5.1: data-testid contract

- [ ] **Step 1:** Ensure these testids exist (add in Tasks 4.x if missing): `grayscale-flatten-toggle`, `grayscale-converter-select`, `grayscale-clahe-toggle`, `grayscale-channel-select`, `grayscale-apply-run`, `grayscale-auto`, `grayscale-resolved-source-converter`, `page-viewer`, `after-image`.
- [ ] **Step 2: Commit** any testid additions — `git commit -am "test(grayscale): data-testid contract for e2e"`

### Task 5.2: Playwright wiring

- [ ] **Step 1:** Add `pytest-playwright>=0.5` to a `[dependency-groups] e2e` uv group; add `make e2e-browser`; add `playwright install chromium` to `make setup`. Use the GPU-disabled Chromium launch args (`--no-sandbox --disable-gpu --disable-dev-shm-usage --disable-software-rasterizer --in-process-gpu --disable-features=Vulkan`, `chromium_sandbox=False`) from `.audit-shots/capture.py`.
- [ ] **Step 2: Commit** — `git commit -am "build(e2e): playwright browser test harness"`

### Task 5.3: App-loads + grayscale-pipeline browser test

**Files:**
- Create: `tests/e2e/test_grayscale_browser.py`

- [ ] **Step 1: Write the test** — start the server (factory `pdomain_prep_for_pgdp.bootstrap:build_app`) on a port; open `/`, assert the app root testid is visible and no `console.error` about failed loads; navigate to a project's grayscale workbench (a real ingested fixture project), assert `[data-testid="after-image"]` has `naturalWidth>0`; change `grayscale-converter-select` to `best_channel`, click `grayscale-apply-run`, and assert the artifact URL updates (the `?v=` busts) — proving the pipeline config reaches the backend and re-renders.
- [ ] **Step 2: Run** — `make e2e-browser` → PASS (run on the GPU host to also exercise the GPU path).
- [ ] **Step 3: Auto-detect browser test** — click `grayscale-auto`, assert a converter is selected and a reason string is shown.
- [ ] **Step 4: Route test** — navigate directly to `/projects/{id}/pipeline?stage=grayscale` and assert the workbench renders (not a 404).
- [ ] **Step 5: Commit** — `git commit -am "test(e2e): grayscale pipeline browser verification"`

### Task 5.4: Wire e2e into CI

- [ ] **Step 1:** Add `make e2e-browser` to `make ci` (or the repo's CI sequence). Confirm `make ci AI=1` runs it.
- [ ] **Step 2: Commit** — `git commit -am "ci: include grayscale browser verification"`

---

## Integration / land

- [ ] Rebase each milestone branch onto current `main`; `make ci AI=1` green; ff-merge (no merge commits); push on CT say-so.
- [ ] Live-verify on the 233-page sample: Auto proposes a sensible pipeline; flatten+green+CLAHE visibly improves a foxed/uneven page; a per-page override changes only that page; GPU path matches CPU output.

---

## Self-review notes

- Spec coverage: pipeline model (M0/M1), 6 ops CPU+GPU (M0), Color2Gray CPU port (0.4), GPU dispatch fix (2.1), 3-tier + app-prefs (M3), Auto detector §8a (3.3), frontend editor + tiers (M4), browser verification (M5), migration (1.3). ✓
- OQ defaults baked in: luma static default (1.3), luma_bt709 continuity (1.3), blur-divide flatten (0.3), variance best-channel auto (0.2), CLAHE-on-CPU-in-GPU-path (0.5/OQ-4), grayscale-only flatten (config). Revisit if CT changes an OQ.
- GPU-dependent tests use `skipif not cupy` and must be run on the GPU host before the GPU milestones are called done.
