# Findings — Scannos, OCR stealth-misses, and the tooling to catch them

> Research report for the **Scannocheck** stage of `pdomain-prep-for-pgdp`.
> Date: 2026-06-02 · v2 (two research rounds). Author: research synthesis (Claude Code).
>
> **What this stage must do:** *suggest* OCR-error suspects to a human proofer
> queue. It FLAGS, it never silently rewrites. Every recommendation below is
> scored against that contract.
>
> **Provenance / confidence.** Built from two web-research passes (a fan-out
> harness plus twelve targeted verification agents) working from primary sources
> — official repos + their LICENSE files, papers, dataset pages, HF model cards,
> the PGDP wiki. Confirmed claims are cited inline. Unconfirmed claims are marked
> **⚠ unverified** rather than asserted. No repos, papers, benchmark numbers, or
> URLs were invented. A few live-page release dates (Hunspell, spaCy, pyspellchecker)
> are reported as read on 2026-06-02 and flagged. The first automated harness run's
> adversarial voter stage hit a tooling fault and abstained on Tracks B–G; those
> were re-verified by hand-directed agents, which is the source of the citations.

---

## 0. Executive summary

**The shape of the answer:** PGDP already built our contract (flag-only,
three-level), so copy its architecture. Stealth recall comes from a
**confusion-set rule engine + n-gram context check** — both cheap, local, and
something everyone builds rather than installs. Our unique edge is **DocTR
per-word confidence**, and there's now a published method (ConfBERT) that fuses
exactly that signal into OCR error *detection*. ML is a stretch layer of
*candidate generators and flaggers a human accepts* — never a silent rewriter,
which is actively dangerous on pre-1920 text.

**Adopt (licence-clean, ready):**

- **PGDP's three-level model** (World / Site / Project), flag-only. The reference
  architecture. [WordCheck FAQ](https://www.pgdp.net/wiki/DP_Official_Documentation:Proofreading/WordCheck_FAQ)
- **`pptext/scannos.txt` + `hebelist.txt` (MIT)** — the *only* cleanly-licensed DP
  seed lists (71 stealth words; ~15k he/be context trigrams). The wiki lists are
  **not** redistributable. [pptext](https://github.com/DistributedProofreaders/pptext)
- **OCR confusion rules from `ocr-stringdist` (MIT) + SubtitleEdit's
  `eng_OCRFixReplaceList.xml` (MIT)** — reusable char/word confusion maps to seed
  our rule engine. [ocr-stringdist](https://github.com/NiklasvonM/ocr-stringdist) ·
  [SubtitleEdit list](https://github.com/SubtitleEdit/subtitleedit/blob/main/Dictionaries/eng_OCRFixReplaceList.xml)
- **Hunspell/aspell** for the World (non-word) layer — but blind to stealth by construction.
- **GCIDE/Webster-1913 (GPL-3.0)** as a period lexicon + **SCOWL `@`-marked
  archaic list (MIT-like)** so we don't flag legitimate archaic spelling.

**Build (small, high-leverage, local):**

- A **confusion-set + regex rule engine** (the standard OCR families + DP pairs).
- A **DocTR-confidence × language-signal suspect fuser** — our differentiator;
  validated as an approach by ConfBERT. [arXiv 2409.04117](https://arxiv.org/abs/2409.04117)

**Try (stretch / ML, all fully local):**

- **KenLM n-gram context scoring (LGPL-2.1)** — Mays/Damerau-style "does a variant
  fit better here?". Scoring a whole book is **seconds–minutes on CPU** (cheap).
  Train on Gutenberg ≤1920 for period fit. [kpu/kenlm](https://github.com/kpu/kenlm)
- **Flag-native neural detectors:** `jvdzwaan/ocrpostcorrection-task-1` (ICDAR-2019
  BERT span tagger, F1≈0.67 EN), **GECToR** token-tagging (Apache-2.0), or
  **ConfBERT/entropy heat-mapping**. These *detect*, they don't rewrite.
- **`pykale/bart-base-ocr` (MIT)** as a *candidate generator* on flagged suspects —
  trained on real 19th-c English newspaper OCR. A human accepts the suggestion.
  [pykale/bart-base-ocr](https://huggingface.co/pykale/bart-base-ocr)

**Skip / de-prioritise:**

- **LLM-as-silent-rewriter on historical text** — documented over-historicization +
  hallucination. Flag/suggest only. [arXiv 2502.01205](https://arxiv.org/abs/2502.01205)
- **`awslabs/mlm-scoring`** — stale (MXNet, transformers ≤3.x). Use GECToR / the
  detectors above instead.
- **SRILM** — research/non-commercial licence. Use KenLM (LGPL).
- **Buying COCA/COHA** — paid/restrictive. CC-BY Google-Books-Ngram, GPL Gutenberg,
  and GPL GCIDE cover it.
- **Waiting for a gold stealth set** — none exists; build a small one.

**Single highest-leverage addition (see §G):** the **DocTR-confidence × language
fuser feeding a confusion-set rule engine**, inside the PGDP three-level
scaffold. ConfBERT shows the confidence-fusion idea works; the rest is rules.

---

## A. PGDP / Distributed Proofreaders domain

**What exists.** "Stealth scanno" is **PGDP's own term**: a valid, correctly-spelled
but wrong word a spellchecker passes; canonical example **`arid` for `and`**.
[Stealth_scanno](https://www.pgdp.net/wiki/Stealth_scanno) ·
[WordCheck FAQ](https://www.pgdp.net/wiki/DP_Official_Documentation:Proofreading/WordCheck_FAQ).
DP ships two production tools:

- **WordCheck** — three precedence levels, each overriding the prior:
  - **World**: aspell spellcheck against the project's primary/secondary language dicts.
  - **Site**: stealth-scanno bad-word lists **+ suspicious shapes** — explicitly,
    **mixed-alphanumeric words** (e.g. `1and`, with ordinals `1st/2nd/3rd` excepted).
    "Patterns are specified site-wide directly in the code." No other shape patterns
    named.
  - **Project**: PM **Good Word List** (suppress flag) / **Bad Word List** (force-flag).
  - **Flag-only**: "the final list of Flagged words are presented to the proofreader
    prompting the proofreader to correct or accept them"; "Unflag All & Suggest" only
    nominates words for the Good Word List — never rewrites.
    [WordCheck FAQ](https://www.pgdp.net/wiki/DP_Official_Documentation:Proofreading/WordCheck_FAQ)
- **Jeebies** — Jim Tinsley; in `guiguts/tools/jeebies/`. **he/be-specific** (data
  files `he.jee`, `be.jee`), Paranoid/Normal/Tolerant tiers.
  [PPTools/Jeebies](https://www.pgdp.net/wiki/PPTools/Jeebies)

**Reusable lists & licences (firm answer to open-Q1):**

| Resource | Contents | Licence | Embed offline? |
|---|---|---|---|
| **`pptext/scannos.txt`** | **71** English stealth words (`arid`, `tho`, `modem`, `coining`…), one/line | **MIT** | **Yes** |
| **`pptext/hebelist.txt`** | ~15k pipe-delimited he/be context trigrams (`afraid\|he\|would:240`) | **MIT** | **Yes** |
| DP wiki `%scannoslist` (per-language) | Perl-hash stealth lists | **none / all-rights-reserved** (no CC/GFDL on wiki; some pages DB-gated) | **No — clear rights first** |
| DP site bad-word lists | in production DB, auth-walled `wordcheck_data.php` | not public | No |

Sources: [pptext + LICENSE](https://github.com/DistributedProofreaders/pptext) ·
[Bad_word_list](https://www.pgdp.net/wiki/Bad_word_list). **Bottom line:** embed
`pptext` (MIT); treat the wiki lists as reference-only until DP grants rights.

**PP tool ecosystem (one line + licence each):**

| Tool | What it is | Licence |
|---|---|---|
| `dproofreaders` | main DP app; WordCheck lives here (PHP) | **GPL-2.0** |
| `guiguts` | Perl/Tk PP editor; integrates Jeebies/WordCheck/gutcheck | GPL-2.0 |
| `pptext` | Go consolidated checks (aspell, he/be, `scannos.txt`) — most self-contained | **MIT** |
| `ppwb` | PHP front-end calling pptext/pphtml/ppcomp | GPL-3.0 |
| `guiprep` | Perl OCR-prep; **archived/unmaintained**; informal "freely used" notice (not OSI) | ⚠ informal |
| `ppgen` (`wf49670/ppgen`) | markup→text/HTML; **no scanno detection** | **⚠ no LICENSE file** |
| `gutcheck` | quote/punctuation/structure checker; not word-level | GPL |

**No standalone regex scanno checker or community word-list repo** found beyond
these. `dproofreaders` has a `show_project_stealth_scannos.php` that uses `wdiff`
diffing, not a published list.

**DP conventions that affect a checker** ([Proofreading Guidelines](https://www.pgdp.net/wiki/DP_Official_Documentation:Proofreading/Proofreading_Guidelines)):
end-of-line hyphenation (`-*`/`*` markers — rejoin before matching); long-s `ſ`
(proofed as printed — don't flag `ſ`→`f`); ligatures `æ/œ/ﬁ` (single Unicode —
Unicode-aware tokenization); em-dashes (`--`/`----`); proofer markup `[**…]`,
`<i>…</i>` (skip/strip before tokenizing). There is also a DPWiki
**[Archaic_Spellings](https://www.pgdp.net/wiki/Archaic_Spellings)** reference page
(`shew`, `chuse`, `to-morrow`, `phantasy`…) useful for hand-curating an allowlist.

**Maturity:** production. **Integration cost:** low. **Recommendation:** **adopt
the three-level architecture; embed `pptext` MIT lists; reimplement Jeebies-he/be
as one confusion rule; do not embed wiki lists without rights.**

---

## B. OCR error characterisation & "stealth" detection

**Taxonomy.** Standard non-word OCR errors (single-char insert/delete/substitute/
transpose + word-boundary run-on/split) in [arXiv 2106.12030](https://arxiv.org/abs/2106.12030)
(2021) — which **explicitly excludes real-word errors**, i.e. exactly our gap.

**The classic real-word-detection lineage:**

- **Mays, Damerau & Mercer 1991** — word-trigram noisy-channel; flag when a
  single-word variant raises sentence probability; **no confusion sets**. Reported
  ~76% detected / ~73% corrected on simple real-word errors. [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/030645739190066U)
- **Golding & Roth 1999** — Winnow over **predefined confusion sets** + context
  features; ~96% on confusion-set errors; auto-corrects. [Springer](https://link.springer.com/article/10.1023/A:1007545901558)
- **Hirst & Budanitsky 2005** — WordNet (Jiang–Conrath) malapropism detection; best
  config **P≈18% / R≈50%**; no confusion sets. [ResearchGate](https://www.researchgate.net/publication/220597376)
- **Wilcox-O'Hearn, Hirst & Budanitsky 2008** — trigram noisy-channel beats the
  WordNet approach even on content words; vocabulary-wide. Exact P/R in the PDF body
  (⚠ table not decoded). [Springer chapter](https://link.springer.com/chapter/10.1007/978-3-540-78135-6_52)

**Takeaways:** (1) the **n-gram-LM/trigram line is the canonical way to catch
stealth scannos without enumerating every pair**; (2) the **confusion-set line**
is high-precision where you *can* enumerate — which we can (DP lists + OCR
families); (3) WordNet malapropism detection is low-precision, English-bound →
low priority. **Prioritising by per-word OCR confidence is our addition** —
none of these had model scores (see §G).

**Recommendation:** **build a confusion-set engine (Golding/Roth-style) + an
n-gram-LM trigram check (Mays/Damerau-style).**

---

## C. Lightweight NLP tooling

**Spellcheck engines — none catch stealth scannos (structural):**

| Tool | Algorithm | Licence | Release (read 2026-06-02) | Real-word? |
|---|---|---|---|---|
| **Hunspell** | affix+dict lookup | LGPL/GPL/MPL tri | v1.7.3 (⚠ live-read) | **No** |
| **GNU aspell** | dict+morphology | LGPL | 0.60.8 (⚠ date) | **No** |
| **SymSpell / symspellpy** | symmetric-delete | MIT | v6.7.x / 2024 | **No** (valid word → itself) |
| **SymSpellCompound** | + compound split/join | MIT | (w/ SymSpell) | segmentation only |

A stealth scanno *is* a dictionary word, so all of these pass it. **SymSpellCompound
is genuinely useful for the segmentation sub-problem** (split `to gether`, join
`ofthe`). Sources: [Hunspell](https://github.com/hunspell/hunspell) ·
[SymSpell](https://github.com/wolfgarbe/SymSpell) · [symspellpy](https://github.com/mammothb/symspellpy).

**Context-aware libraries (the real-word question):**

| Library | Licence | Last release | Flags real-word? | Status |
|---|---|---|---|---|
| **language-tool-python** | **GPL-3.0** | v3.4.0 May 2026 | **Yes** — LanguageTool confusion-word rules; returns `Match` objects (flag, no auto-apply) | maintained |
| **OCRfixr** | MIT | v1.5.1 Feb 2023 | partial (symspell + BERT context, OCR-targeted) | **dormant** |
| neuspell | MIT | ~2021 | ⚠ claims context, RWE undocumented | stale |
| contextualSpellCheck | MIT | v0.4.4 2023 | **No** (RWE is a "todo") | stale |
| JamSpell | MIT | 2020 | **No** (bigram ranking, auto-correct) | stale |
| pyspellchecker | MIT | v0.9.0 2026 | **No** | maintained |
| autocorrect / TextBlob | MIT | 2021–22 | **No** | stale |

**`language-tool-python` is the only verified off-the-shelf lib that flags
real-word errors in context** — but **GPL-3.0** is a distribution constraint, and it
wraps a Java process. **OCRfixr** is the closest pre-built *OCR* flagger (symspell
candidates + BERT ranking) but dormant — its approach is reusable even if the
package isn't. Sources: [language-tool-python](https://pypi.org/project/language-tool-python/) ·
[OCRfixr](https://pypi.org/project/OCRfixr/).

**Reusable OCR confusion rulesets (so we don't author from zero):**

- **`ocr-stringdist`** (MIT, maintained) — pip-installable Python char-confusion
  *map* (`0↔O`, `1↔l`, `5↔S`…), extensible. [repo](https://github.com/NiklasvonM/ocr-stringdist)
- **SubtitleEdit `eng_OCRFixReplaceList.xml`** (MIT, maintained) — large word-level
  OCR confusion list (`0f→of`, `vv→w`…); subtitle-domain, mine selectively.
- PGDP wiki [Scanno](https://www.pgdp.net/wiki/Scanno) / [Common_errors](https://www.pgdp.net/wiki/Common_errors_proofers_find)
  — human-readable confusion pairs, prose only (not importable).

**n-gram LMs (context scoring — cheap, local):**

- **KenLM** (LGPL-2.1), [kpu/kenlm](https://github.com/kpu/kenlm) — `PROBING`/`TRIE`,
  Python `kenlm.Model.score()`; build via `lmplz -o 5` + `build_binary` (CPU-only).
  A 1B-word 5-gram is ~10–30 GB binary (prunable). **Scoring 400k words × ~20
  candidates ≈ 5–60 s on one CPU core** (⚠ estimate from documented query speed) —
  i.e. effectively free. Production-ready.
- **`edugp/kenlm`** (HF, **MIT**) — pretrained, 24 langs, Wikipedia+OSCAR;
  `get_perplexity()`. **Modern corpus** — not period English.
- **SRILM** — **research/non-commercial licence only** (paid licence for commercial);
  KenLM supersedes it for us. [SRILM licence text](https://github.com/nassosoassos/sail_align/blob/master/LICENSE/srilm-license)
- **No pretrained pre-1920/Gutenberg KenLM found** (⚠) — train your own; imagineville.org
  has CC-BY 4-gram KenLMs that *include* Gutenberg but diluted with modern web text.

**Scaffolding:** spaCy (MIT) / NLTK (Apache-2.0) for tokenize/POS. **No purpose-built
spaCy/NLTK OCR real-word pipeline exists (⚠).** Real-word flagging is always custom.

**Recommendation:** **Hunspell/aspell (World); SymSpellCompound (segmentation);
KenLM (context, train period model); seed rules from `ocr-stringdist` + SubtitleEdit;
consider `language-tool-python` if GPL-3.0 is acceptable; mine OCRfixr's design.**

---

## D. ML / LLM tooling

**ICDAR Post-OCR Text Correction competitions** (the field's benchmark):
**2017** (Chiron, Doucet; ~12M chars, EN+FR; char-level SMT/NMT strong) and
**2019** (Rigaud, Doucet, Coustaty, Moreux; ~22M chars, 10 langs; ensemble seq2seq + BERT
re-ranking; best EN-adjacent detection ~95% German, Clova AI). Two subtasks:
**error detection** + **correction**. [ICDAR2017 HAL](https://hal.science/hal-03025499v1) ·
[ICDAR2019 HAL](https://hal.science/hal-02304334v1). **Survey:** Nguyen, Jatowt,
Coustaty & Doucet, *ACM Computing Surveys* 54(6):124, 2021. [ACM](https://dl.acm.org/doi/10.1145/3453476)

**Flag-native neural detectors (detect, don't rewrite — our preferred ML shape):**

| Model / method | Licence | Approach | Notes |
|---|---|---|---|
| **`jvdzwaan/ocrpostcorrection-task-1`** | ⚠ (base Apache-2.0) | BERT token classifier on ICDAR-2019 | **Flags error spans**, F1≈0.67 EN; drop-in detector. [HF](https://huggingface.co/jvdzwaan/ocrpostcorrection-task-1) |
| **GECToR** (`grammarly/gector`) | Apache-2.0 | token-tagging (`$KEEP`=correct) | flag-native; ~10× faster than seq2seq. [repo](https://github.com/grammarly/gector) |
| **ConfBERT** (arXiv 2409.04117, 2024) | (paper) | MLM + noise head, **ingests OCR confidence into token embeddings** | **directly validates our DocTR-confidence fusion**; detection-only. [arXiv](https://arxiv.org/abs/2409.04117) |
| **Entropy heat-mapping** (arXiv 2505.00746, 2025) | (paper) | sliding-window token-entropy "hotspots" | flag-native, cheap localization. [arXiv](https://arxiv.org/abs/2505.00746) |
| **`sahilnishad/BERT-GED-FCE-FT`** | MIT | binary token classification | flag-native GED. [HF](https://huggingface.co/sahilnishad/BERT-GED-FCE-FT) |

**`awslabs/mlm-scoring` (Salazar et al. 2020 pseudo-perplexity) is stale** (MXNet,
open transformers-4.x issue since 2021) — the *method* is sound (mask each token,
low PLL = poor fit = flag) but use a maintained detector instead.
[paper](https://aclanthology.org/2020.acl-main.240/) · [repo issue #11](https://github.com/awslabs/mlm-scoring/issues/11).
**Cost:** per-token masking ≈ one forward pass/token → ~520k passes for 400k words;
**window-level scoring (stride ~64) is ~65× cheaper** and enough to localize a
suspect region. RTX-4090 BERT-base ≈ 180 seq/s → **~1–10 min/book batched** (⚠
arithmetic estimate). [ModernBERT throughput](https://arxiv.org/html/2412.13663v2).

**Seq2seq candidate generators (suggest only — a human accepts):**

| Model ID | Licence | Trained on | OCR-specific? | NC? |
|---|---|---|---|---|
| **`pykale/bart-base-ocr`** / **`-large-ocr`** | **MIT** | **BLN600 — 19th-c English newspaper OCR↔human** | **Yes** | No |
| `pykale/llama-2-7b-ocr` | MIT | BLN600 (PEFT) | Yes | No |
| `yelpfeast/byt5-base-english-ocr-correction` | ⚠ none stated | WikiText + *synthetic* OCR noise | synthetic | ⚠ |
| `google/byt5-small`/`-base` | Apache-2.0 | mC4 (pretrain only) | No (backbone) | No |
| `oliverguhr/spelling-correction-english-base` | MIT | undocumented | No (general) | No |
| `prithivida/grammar_error_correcter_v1` (Gramformer) | **MIT** | undocumented | No (GEC) | No |
| `pszemraj/flan-t5-large-grammar-synthesis` | Apache-2.0 model / **NC dataset** | JFLEG-expanded | No (GEC) | ⚠ grey |
| `vennify/t5-base-grammar-correction` | **CC-BY-NC-SA-4.0** | JFLEG | No (GEC) | **Yes** |

**`pykale/bart-base-ocr` (MIT, real historical-English OCR) is the standout** —
licence-clean, period-appropriate, OCR-specific. Use as a candidate generator on
*flagged* suspects only. The GEC checkpoints are mostly general and several are
**NC-licensed** — check before distribution. **`microsoft/trocr-*` is a recognition
model (image→text), NOT text correction** — confirmed, don't confuse it.
Sources: [pykale/bart-base-ocr](https://huggingface.co/pykale/bart-base-ocr) ·
[byt5-small](https://huggingface.co/google/byt5-small) ·
[Gramformer LICENSE](https://github.com/PrithivirajDamodaran/Gramformer/blob/main/LICENSE).

**LLM-as-proofreader:** arXiv 2502.01205 ("No Free Lunches") — improves English OCR
but **degrades** Finnish; failure modes = **hallucinated continuations** +
**over-historicization** (inserting archaic glyphs from the wrong period);
historical normalization alone swung CER 20+ points. [arXiv](https://arxiv.org/abs/2502.01205).
LaTeCH-CLfL 2024 (ByT5 on Swedish historical, 36% CER↓, production-local) shows
**fine-tuned small model > prompted giant LLM** for historical OCR.
[2024.latechclfl-1.23](https://aclanthology.org/2024.latechclfl-1.23/). **No paper
benchmarks LLMs constrained to diff/flag-only output (⚠)** — but JSON-schema-constrained
generation is the only LLM mode compatible with our contract.

**Pre-1920 English:** over-historicization is *the* reason to flag not rewrite —
treat period spelling as read-only (also confirmed in arXiv 2504.00414).

**Recommendation:** **flag-native detector (`jvdzwaan…` or GECToR; ConfBERT-style
confidence fusion as the build target); `pykale/bart-base-ocr` as a suggest-only
candidate generator; LLM only as a constrained flag pass; never auto-rewrite.**

---

## E. Datasets, benchmarks, lexicons

**Period-appropriate lexicons / frequency (so archaic spelling isn't flagged):**

| Resource | What | Licence | Period fit | Offline? |
|---|---|---|---|---|
| **GCIDE / Webster's 1913** | ~180k headwords, 1913 base text | **GPL-3.0** | **excellent** | Yes ([GCIDE](https://gcide.gnu.org.ua/license)) |
| **SCOWL / ESDB** | word lists with **`@`=archaic** markers | MIT-like | good (extract `@` for allowlist) | Yes ([wordlist.aspell.net](https://wordlist.aspell.net/)) |
| **Google Books Ngram v3** | frequency, per-year counts | **CC BY 3.0** | **year-filter ≤1920** | Yes ([dataset](https://storage.googleapis.com/books/ngrams/books/datasetsv3.html)) |
| **orgtre/google-books-ngram-frequency** | cleaned lists + year-filter code | CC BY 3.0 | adjustable window | Yes ([repo](https://github.com/orgtre/google-books-ngram-frequency)) |
| **pgcorpus/gutenberg** | PG corpus pipeline + per-book year | GPL-3.0 | filter to ≤1920 | Yes ([repo](https://github.com/pgcorpus/gutenberg)) |
| **wordfreq** | general modern frequency | Apache/CC-BY-SA | poor (modern, **sunset/frozen**) | Yes ([repo](https://github.com/rspeer/wordfreq)) |
| Wiktionary "English archaic terms" | archaic word category | CC-BY-SA | archaic allowlist | via dump |

**COHA/COCA (Davies):** free to *search*; **word/frequency downloads are paid**
($395+) and restrictive — **skip the purchase**; COCA is modern anyway.
**Best period stack:** GCIDE (1913 lexicon) + SCOWL `@`-archaic allowlist + a
KenLM/frequency model trained on year-filtered Google-Books-Ngram or Gutenberg ≤1920.

**OCR post-correction datasets:**

- **ICDAR-2019** [zenodo 3515403](https://zenodo.org/records/3515403): ~22M chars +
  aligned GT, 10 langs, **CC BY 4.0** (⚠ **Finnish subset restricted**). ~54 MB.
- **MiBio** [PMC6197712](https://pmc.ncbi.nlm.nih.gov/articles/PMC6197712/): 2,907
  labelled OCR errors, one English book — good detection smoke test.
- **BLN600** — 19th-c English newspaper OCR↔transcription (the `pykale` training set);
  historical-English-specific.
- **GT4HistOCR** (CC-BY-4.0, Fraktur/Latin), **IMPACT-es** (CC-BY-NC-SA, Spanish).

**Gold stealth-scanno eval set: none found (⚠).** PGDP defines the term but
publishes no labelled benchmark of real-word OCR confusions. **We must build one.**

**Classical lexicons (for Greek/Latin spans):** CLTK (MIT) Latin/Greek lemma lists;
**Whitaker's Words `DICTLINE.GEN`** (~39k Latin stems, **public domain**); CLTK
`*_lexica_perseus` (MPL-1.1). All offline-embeddable.

**Recommendation:** **GCIDE + SCOWL-archaic + Google-Books-Ngram(≤1920) as the
period prior; ICDAR-2019 + MiBio + BLN600 for testing; build a small in-house
stealth gold set; Whitaker's/CLTK for classical spans.**

---

## F. Evaluation methodology

- **ICDAR detection metric = token-level precision/recall/F1 (F1 ranks).** Correction
  = weighted Levenshtein, fully- vs semi-automated. Hyphen-split/`#`-aligned tokens
  excluded. [ICDAR2019 eval](https://sites.google.com/view/icdar2019-postcorrectionocr/evaluation)
- **Ranked-suspect evaluation:** Nguyen et al. report **P@n** (n=1,3,5,10) — fraction
  of errors whose correct form is in the top-n; detection recall ~91% loose / ~74%
  exact-boundary. Closest primary source to "suspects-per-error". [ar5iv 1611.06950](https://ar5iv.labs.arxiv.org/html/1611.06950)
- **Human-in-the-loop:** **PoCoTo** (IMPACT, DATeCH 2014) — "40–80 hand-corrected lines
  lead to CER of a few percent"; measures reviewer effort directly. [ACM](https://dl.acm.org/doi/10.1145/2595188.2595197).
  **Rose Holley 2009** (D-Lib, Trove/ANDP) — rationed reviewers to "article headings
  and first four lines to 99.5%", rest to the crowd; the canonical reviewer-effort
  reference. [D-Lib](http://www.dlib.org/dlib/march09/holley/03holley.html)
- **"Reviewer burden" as a named metric: not found (⚠)** — it's standard IR
  precision/recall; per-page caps are an engineering choice. Adopt it explicitly
  anyway: track **suspects-per-page** and **suspects-per-confirmed-error**.
- **A/B without ground truth: no OCR-specific source (⚠).** Suggestion **accept-rate**
  (precision proxy) and **time-to-clear** (burden proxy) are defensible, borrowed
  from interactive-revision (arXiv 2204.03685) and code-suggestion studies.

**Recommendation:** **report token P/R/F1 (F1 headline) + P@n on a held-out set;
operate against a suspects-per-page cap; A/B on accept-rate + time-to-clear.**

---

## G. Fit to our pipeline

**What we have that DP's tools never did:** DocTR **per-word confidence**, page
zones, per-page language (Greek/Latin), a lexicon, a stealth list, a local GPU.

**Highest-leverage addition:** a **suspect-scoring fuser** combining DocTR
confidence with a language signal, feeding a **confusion-set + regex rule engine**,
wrapped in PGDP's three-level structure. **ConfBERT (arXiv 2409.04117) is published
evidence this works** — it folds OCR confidence into a BERT detector and improves
error detection. The confidence signal lets us *prioritise* the queue
(low-confidence × dictionary-valid = prime stealth suspect) the way the classic
methods never could.

**Build-vs-adopt, per component:**

| Component | Decision | Why |
|---|---|---|
| World (non-word) | **Adopt** Hunspell/aspell | production, local, free |
| Site structure + seed | **Adopt** PGDP 3-level + `pptext` MIT lists | exact contract; clean seed |
| Confusion rules | **Build**, seeded by `ocr-stringdist`+SubtitleEdit (MIT) | high precision; no full drop-in |
| he/be | **Adopt (reimplement)** Jeebies logic | one confusion-pair rule (GPL — reimplement) |
| Segmentation | **Adopt** SymSpellCompound (MIT) | targets split/join directly |
| Context scoring | **Build on** KenLM (LGPL), period-trained | cheap (s–min/book), local |
| **Confidence × language fuser** | **Build** (ConfBERT-validated) | our unique signal; the differentiator |
| Stealth flagger (ML) | **Try** `jvdzwaan…`/GECToR (flag-native) | detect-not-rewrite |
| Candidate generation | **Try** `pykale/bart-base-ocr` (MIT, historical) | suggest-only; human accepts |
| Period prior | **Adopt** GCIDE + SCOWL-archaic + GBN≤1920 | avoid flagging archaic spelling |
| Greek routing | **Adopt** Unicode-block scan (+ GlotLID if grc/ell matters) | trivial, zero false-neg |
| Latin routing | **Build** lexicon-overlap (Whitaker's PD + CLTK MIT), lingua-py fallback | same-script hard case |

**Cost / latency (100k–400k words/book, local GPU):** rules + lexicon + **KenLM are
seconds–minutes (CPU)**; the neural detector/candidate-gen is the only GPU load and
is **~1–10 min/book batched** (⚠ estimate), with candidate generation run *only on
flagged suspects*. **Everything recommended runs fully local/offline.**

**Flag-vs-rewrite discipline:** every adopted component is a scorer/flagger; the
only generative component (`pykale/bart`/LLM) is confined to *proposing* a fix a
human accepts. Non-negotiable on pre-1920 text (over-historicization, §D).

---

## Comparison table

| Name | Approach | Input it needs | Catches stealth? | Licence | Last release/update | Our fit |
|---|---|---|---|---|---|---|
| **PGDP WordCheck** | 3-level flag | text, dicts, lists | **Yes** (Site) | ⚠ (DP, GPL-2.0 app) | living | **Architecture to copy** |
| **Jeebies** | he/be `.jee` | text | he/be only | GPL-2.0 | living | Reimplement as 1 rule |
| **pptext scannos/hebelist** | curated lists | — | seed | **MIT** | living | **Embed as seed** |
| **ocr-stringdist** | char-confusion map | — | rule source | **MIT** | maintained | **Seed confusion rules** |
| **SubtitleEdit OCR list** | word-confusion XML | — | rule source | **MIT** | maintained | Mine for rules |
| **Hunspell / aspell** | dict lookup | text, dict | No | LGPL/GPL/MPL · LGPL | 2026 / ~ | World layer |
| **SymSpellCompound** | compound split/join | text, freq | segmentation | MIT | 2024 | **Segmentation** |
| **language-tool-python** | rule engine | text | **Yes** (context) | **GPL-3.0** | v3.4.0 2026 | Optional 2nd-pass (GPL) |
| **OCRfixr** | symspell+BERT | text | partial (OCR) | MIT | 2023 (dormant) | Mine design |
| **KenLM** | n-gram scoring | corpus/arpa | indirect (context) | LGPL-2.1 | active | **Context scorer (period-train)** |
| **edugp/kenlm** | pretrained KenLM | text | indirect | MIT | active | Quickstart (modern ⚠) |
| **jvdzwaan/ocrpostcorrection-task-1** | BERT span tagger | text | **detects** (F1≈.67 EN) | ⚠ (base Apache-2.0) | ICDAR-2019 | **Flag-native detector** |
| **GECToR** | token tagging | text | detects (GED) | Apache-2.0 | ~2021 | Flag-native detector |
| **ConfBERT** | MLM + confidence | text + **OCR conf** | **detects** | paper | 2024 | **Confidence-fusion blueprint** |
| **pykale/bart-base-ocr** | BART seq2seq | text | as *candidate* | **MIT** | 2024 | **Historical candidate gen** |
| **byt5 / GEC checkpoints** | seq2seq | text | as *candidate* | mixed; some **NC** ⚠ | various | Candidate gen (licence-check) |
| **GCIDE / Webster-1913** | period lexicon | — | n/a (prior) | GPL-3.0 | static | **Period lexicon** |
| **SCOWL** | wordlist + `@`archaic | — | n/a (allowlist) | MIT-like | active | **Archaic allowlist** |
| **Google-Books-Ngram v3** | frequency, per-year | — | n/a (prior) | **CC BY 3.0** | 2020 | **Period prior (≤1920)** |
| **Whitaker's Words** | Latin stems | — | n/a (routing) | **public domain** | static | Latin lexicon-overlap |
| **GlotLID / lingua-py** | language ID | text span | n/a (routing) | Apache-2.0 | active | Greek/Latin routing |
| **ICDAR-2019 / MiBio / BLN600** | labelled OCR+GT | — | eval | CC-BY-4.0 / etc. | 2018–19 | Test sets |

---

## Minimum-viable Scannocheck (build first — no ML)

Fully-local, mostly rules:

1. **Normalize** (DP conventions): rejoin hyphenation, strip `[**…]`/`<i>`,
   Unicode-aware tokenization, leave long-s/ligatures intact.
2. **World**: Hunspell/aspell per page language → non-word flags.
3. **Site**: embed `pptext/scannos.txt` (MIT) + confusion families seeded from
   `ocr-stringdist`/SubtitleEdit (`rn↔m`, `cl↔d`, `li↔h`, `vv↔w`, `1↔l↔I`, `0↔O`);
   he/be rule (from `hebelist.txt`); mixed-alphanumeric shape heuristic.
4. **Project**: per-book Good/Bad word lists.
5. **Period guard**: GCIDE/SCOWL-archaic allowlist so archaic spelling isn't flagged.
6. **Prioritise by DocTR confidence**: `(dictionary-valid) × (low model confidence)`.
7. **Segmentation**: SymSpellCompound pass.
8. **Output = suspects only** (word-in-context, type, score, Fix/Keep). Never rewrites.

**Effort:** ~1–2 weeks. Offline, sub-minute latency.

## Stretch / ML proposal (layer on after MVP — all local)

1. **KenLM trigram context check** (Mays/Damerau signal), trained on Google-Books-Ngram
   or Gutenberg ≤1920 so period spelling isn't penalised. (Cheap, CPU.)
2. **Flag-native neural detector**: `jvdzwaan/ocrpostcorrection-task-1` or GECToR to
   surface stealth suspects; later, **build a ConfBERT-style detector that ingests
   DocTR confidence** (our differentiator).
3. **`pykale/bart-base-ocr` candidate generator** on flagged suspects only — propose a
   fix the proofer accepts/rejects; never auto-apply.
4. **Greek**: Unicode-block scan (+ GlotLID grc/ell). **Latin**: Whitaker's/CLTK
   lexicon-overlap heuristic, lingua-py fallback — route spans to the right checker.
5. **Optional constrained-LLM flag pass** (structured/diff-only) for extra recall.

**Effort:** ~3–5 weeks incremental. Fully local on our GPU.

---

## Open questions & suggested experiments

| # | Question | Experiment | Effort |
|---|---|---|---|
| 1 | ~~DP wiki lists redistributable?~~ **Answered: no** — only `pptext` MIT lists are clean | Embed `pptext`; ask DP to license the wiki lists if we want more | done / 0.5 d |
| 2 | Does a flag-native neural detector (jvdzwaan/GECToR) beat rules+lexicon on stealth, at acceptable cost? | Build the in-house stealth set (Q4); benchmark detector marginal recall + wall-clock on our GPU | 3–5 d |
| 3 | Does year-filtered Google-Books-Ngram (≤1920) + GCIDE/SCOWL reduce false flags on archaic spelling? | A/B the period prior on a pre-1920 book; count archaic false flags | 2–3 d |
| 4 | No public gold stealth set — build one | Hand-label real-word OCR confusions on N pages of our DocTR output; reuse MiBio/ICDAR-2019/BLN600 for non-word smoke tests | 3–4 d |
| 5 | Best fusion of DocTR confidence + language signal? (ConfBERT-style) | Weighted blend / small classifier over (confidence, KenLM perplexity-delta, rule-hit); tune on Q4 vs suspects-per-page | 2–4 d |
| 6 | Does `pykale/bart-base-ocr` propose useful fixes without over-historicizing? | Run on flagged suspects only; manual accept-rate on a sample; never auto-apply | 2–3 d |
| 7 | Latin-span detection on interleaved single-line quotations | Whitaker's/CLTK lexicon-overlap + lingua-py on a multilingual pre-1920 sample | 2 d |
| 8 | Reviewer-burden operating point | Instrument the Suspects queue for accept-rate + time-to-clear; pick a suspects-per-page cap from the curve | ongoing |

---

## Source list (primary unless noted)

**PGDP / DP:**
[WordCheck FAQ](https://www.pgdp.net/wiki/DP_Official_Documentation:Proofreading/WordCheck_FAQ) ·
[Stealth_scanno](https://www.pgdp.net/wiki/Stealth_scanno) ·
[Bad_word_list](https://www.pgdp.net/wiki/Bad_word_list) ·
[Archaic_Spellings](https://www.pgdp.net/wiki/Archaic_Spellings) ·
[PPTools/Jeebies](https://www.pgdp.net/wiki/PPTools/Jeebies) ·
[pptext](https://github.com/DistributedProofreaders/pptext) ·
[dproofreaders](https://github.com/DistributedProofreaders/dproofreaders) ·
[ppwb](https://github.com/DistributedProofreaders/ppwb) ·
[Proofreading Guidelines](https://www.pgdp.net/wiki/DP_Official_Documentation:Proofreading/Proofreading_Guidelines)

**Real-word detection lineage:**
[Mays-Damerau-Mercer 1991](https://www.sciencedirect.com/science/article/abs/pii/030645739190066U) ·
[Golding & Roth 1999](https://link.springer.com/article/10.1023/A:1007545901558) ·
[Hirst & Budanitsky 2005](https://www.researchgate.net/publication/220597376) ·
[Wilcox-O'Hearn et al. 2008](https://link.springer.com/chapter/10.1007/978-3-540-78135-6_52) ·
[OCR error taxonomy 2106.12030](https://arxiv.org/abs/2106.12030)

**Lightweight tooling + rules:**
[Hunspell](https://github.com/hunspell/hunspell) · [SymSpell](https://github.com/wolfgarbe/SymSpell) ·
[symspellpy](https://github.com/mammothb/symspellpy) ·
[language-tool-python](https://pypi.org/project/language-tool-python/) ·
[OCRfixr](https://pypi.org/project/OCRfixr/) ·
[ocr-stringdist](https://github.com/NiklasvonM/ocr-stringdist) ·
[SubtitleEdit OCR list](https://github.com/SubtitleEdit/subtitleedit/blob/main/Dictionaries/eng_OCRFixReplaceList.xml) ·
[KenLM](https://github.com/kpu/kenlm) · [edugp/kenlm](https://huggingface.co/edugp/kenlm) ·
[SRILM licence](https://github.com/nassosoassos/sail_align/blob/master/LICENSE/srilm-license)

**ML / LLM:**
[ICDAR2017](https://hal.science/hal-03025499v1) · [ICDAR2019](https://hal.science/hal-02304334v1) ·
[Nguyen survey 2021](https://dl.acm.org/doi/10.1145/3453476) ·
[ConfBERT 2409.04117](https://arxiv.org/abs/2409.04117) ·
[Entropy heat-mapping 2505.00746](https://arxiv.org/abs/2505.00746) ·
[GECToR](https://github.com/grammarly/gector) ·
[jvdzwaan/ocrpostcorrection-task-1](https://huggingface.co/jvdzwaan/ocrpostcorrection-task-1) ·
[MLM scoring 2020](https://aclanthology.org/2020.acl-main.240/) ·
[No Free Lunches 2502.01205](https://arxiv.org/abs/2502.01205) ·
[ByT5 historical (LaTeCH 2024)](https://aclanthology.org/2024.latechclfl-1.23/) ·
[pykale/bart-base-ocr](https://huggingface.co/pykale/bart-base-ocr) ·
[byt5-small](https://huggingface.co/google/byt5-small)

**Datasets / lexicons:**
[ICDAR-2019 dataset](https://zenodo.org/records/3515403) · [MiBio](https://pmc.ncbi.nlm.nih.gov/articles/PMC6197712/) ·
[GCIDE](https://gcide.gnu.org.ua/license) · [SCOWL](https://wordlist.aspell.net/) ·
[Google Books Ngram v3](https://storage.googleapis.com/books/ngrams/books/datasetsv3.html) ·
[orgtre ngram freq](https://github.com/orgtre/google-books-ngram-frequency) ·
[pgcorpus/gutenberg](https://github.com/pgcorpus/gutenberg) · [wordfreq](https://github.com/rspeer/wordfreq) ·
[CLTK](https://cltk.org/) · [Whitaker's Words](https://github.com/mk270/whitakers-words)

**Evaluation:**
[ICDAR2019 eval](https://sites.google.com/view/icdar2019-postcorrectionocr/evaluation) ·
[Nguyen P@n 1611.06950](https://ar5iv.labs.arxiv.org/html/1611.06950) ·
[PoCoTo DATeCH 2014](https://dl.acm.org/doi/10.1145/2595188.2595197) ·
[Holley 2009 D-Lib](http://www.dlib.org/dlib/march09/holley/03holley.html)

**Language routing:**
[GlotLID](https://huggingface.co/cis-lmu/glotlid) · [lingua-py](https://github.com/pemistahl/lingua-py) ·
[Detecting Latin 2510.19585](https://arxiv.org/abs/2510.19585)
