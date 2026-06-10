// page-workbench-stages.jsx — the 12 per-page workbench bodies, composed from
// the scaffold primitives in page-workbench.jsx. One component per page-scoped
// stage; <PageWorkbench stage="…" /> dispatches. Loaded after page-workbench.jsx
// and source.jsx (for FakeThumb) in each stage's index.html.

/* ====================================================================
   Small overlay helpers (absolute % boxes over a WBPage).
==================================================================== */
const OvBox = ({ t, l, w, h, color, label, dashed, num, fill = 8 }) => (
  <div style={{
    position: 'absolute', top: t + '%', left: l + '%', width: w + '%', height: h + '%',
    border: (dashed ? '1.5px dashed ' : '1.5px solid ') + color,
    background: 'color-mix(in oklab, ' + color + ' ' + fill + '%, transparent)',
    borderRadius: 2,
  }}>
    {label ? (
      <span style={{ position: 'absolute', top: -7, left: 4, padding: '0 5px', borderRadius: 3, background: color, color: '#0c0c10', fontFamily: 'var(--mono-font)', fontSize: 8.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
    ) : null}
    {num != null ? (
      <span style={{ position: 'absolute', top: 3, left: 3, width: 14, height: 14, borderRadius: 99, background: color, color: '#0c0c10', fontFamily: 'var(--mono-font)', fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{num}</span>
    ) : null}
  </div>
);

/* Bowed mesh (dewarp) */
const MeshOverlay = ({ color = 'var(--ocr)' }) => (
  <svg viewBox="0 0 100 132" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.7 }}>
    {[18, 40, 62, 84, 106].map((y, r) => (
      <path key={r} d={`M8 ${y} Q50 ${y - 7 + r * 1.4} 92 ${y}`} fill="none" stroke={color} strokeWidth="0.7" />
    ))}
    {[8, 29, 50, 71, 92].map((x, c) => (
      <path key={c} d={`M${x} 16 Q${x + (c - 2) * 2.2} 66 ${x} 116`} fill="none" stroke={color} strokeWidth="0.7" />
    ))}
  </svg>
);

/* Tilted baseline guides (deskew) */
const SkewGuides = ({ deg = 2.4, color = 'var(--mismatch)' }) => (
  <div style={{ position: 'absolute', inset: '14% 12%' }}>
    {[0, 1, 2, 3, 4].map(i => (
      <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (12 + i * 18) + '%', height: 1, background: color, opacity: 0.8, transform: 'rotate(' + deg + 'deg)' }} />
    ))}
  </div>
);

/* Speckle marks (denoise before) + protected punctuation boxes */
const ProtectMarks = () => (
  <>
    {[[22, 30], [70, 24], [44, 58], [18, 74], [60, 82]].map(([t, l], i) => (
      <span key={i} style={{ position: 'absolute', top: t + '%', left: l + '%', width: 7, height: 7, borderRadius: 2, border: '1.5px solid var(--exact)', background: 'color-mix(in oklab, var(--exact) 12%, transparent)' }} />
    ))}
  </>
);

/* Text block with some highlighted words (wordcheck / text review). */
const TextBlock = ({ lines, w = 300 }) => (
  <div style={{ width: w, flex: '0 0 auto', background: 'var(--bg-sunk)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px', fontFamily: 'var(--mono-font)', fontSize: 12, lineHeight: 1.9, color: 'var(--ink-2)' }}>
    {lines.map((line, i) => (
      <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
        {line.map((seg, j) => seg.hl ? (
          <span key={j} style={{
            background: 'color-mix(in oklab, ' + seg.hl + ' 22%, transparent)',
            borderBottom: '2px solid ' + seg.hl, borderRadius: '2px 2px 0 0', color: 'var(--ink-1)', padding: '0 1px',
          }}>{seg.t}</span>
        ) : <span key={j}>{seg.t}</span>)}
      </div>
    ))}
  </div>
);

/* Section label inside a panel body. */
const WBGroupLabel = ({ children, right }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{children}</span>
    {right || null}
  </div>
);

/* Selectable list row (suspects, zones, illustrations…). */
const WBListRow = ({ active, tone = 'var(--accent)', main, sub, right }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
    background: active ? 'color-mix(in oklab, ' + tone + ' 10%, var(--bg-surface))' : 'var(--bg-sunk)',
    border: '1px solid ' + (active ? 'color-mix(in oklab, ' + tone + ' 40%, var(--border-1))' : 'var(--border-1)'),
  }}>
    <span style={{ width: 6, height: 6, borderRadius: 99, background: tone, flex: '0 0 auto' }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{main}</div>
      {sub ? <div style={{ marginTop: 1, fontSize: 10.5, color: 'var(--ink-3)' }}>{sub}</div> : null}
    </div>
    {right || null}
  </div>
);

/* ====================================================================
   IMAGE-PREP GROUP
==================================================================== */

/* 03 · Crop — rough bbox per page */
const CropWB = () => (
  <WBLayout
    title="Page workbench · Crop"
    sub="Inspect and adjust the detected content box for this page. Drag the frame handles, or tune the auto-detect padding; flagged pages are ones where the detector was unsure."
    applyLabel="Apply crop"
    left={
      <WBPanel label="Crop controls" badge={<Badge tone="dirty">flagged</Badge>}>
        <WBField label="Detection" hint="auto">
          <WBSegment active="content" options={[{ id: 'content', label: 'Content', icon: 'image' }, { id: 'fixed', label: 'Fixed', icon: 'copy' }, { id: 'manual', label: 'Manual', icon: 'wrench' }]} />
        </WBField>
        <WBField label="Edge padding" hint="px around content"><WBSlider value={28} min={0} max={120} unit="px" /></WBField>
        <WBField label="Min content threshold" hint="ignore stray marks below"><WBSlider value={6} min={0} max={40} unit="px" /></WBField>
        <WBStatGrid items={[['Box', '1980 × 3120'], ['Trimmed', '14.2%', 'var(--fuzzy)'], ['Skew of box', '0.3°'], ['Confidence', '0.71', 'var(--fuzzy)']]} />
        <WBNote tone="warn" title="Why flagged">Detected box hugs the text tighter than the project median — a running header may be getting clipped. Confirm or nudge the top edge.</WBNote>
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122} toolbarExtra={<Button variant="ghost" size="sm" icon="refresh">Re-detect</Button>}>
        <WBPage tone="light" cornerLabel="RAW · p0123">
          <CropFrame inset="6% 9% 9% 9%" label="content box · 1980 × 3120" />
        </WBPage>
      </WBViewer>
    }
  />
);

/* 04 · Threshold — grayscale → bilevel */
const ThresholdWB = () => (
  <WBLayout
    title="Page workbench · Threshold"
    sub="Preview the bilevel result for this page against the grayscale source. Pick a method and tune the cut-point; watch ink coverage so light strokes survive and the background stays clean."
    applyLabel="Apply threshold"
    left={
      <WBPanel label="Threshold controls">
        <WBField label="Method">
          <WBSegment active="sauvola" options={[{ id: 'otsu', label: 'Otsu' }, { id: 'sauvola', label: 'Sauvola' }, { id: 'manual', label: 'Manual' }]} />
        </WBField>
        <WBField label="Cut point" hint="0 = black · 255 = white"><WBSlider value={142} min={0} max={255} /></WBField>
        <WBField label="Window size" hint="local · Sauvola"><WBSlider value={31} min={5} max={75} unit="px" /></WBField>
        {/* mini histogram */}
        <WBField label="Luminance histogram">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 46, padding: '6px 8px', background: 'var(--bg-sunk)', border: '1px solid var(--border-1)', borderRadius: 6, position: 'relative' }}>
            {Array.from({ length: 40 }).map((_, i) => {
              const v = Math.exp(-Math.pow((i - 7) / 5, 2)) * 0.7 + Math.exp(-Math.pow((i - 33) / 4, 2));
              return <div key={i} style={{ flex: 1, height: (10 + v * 30) + 'px', background: i < 22 ? 'var(--ink-3)' : 'var(--border-3)' }} />;
            })}
            <div style={{ position: 'absolute', top: 4, bottom: 4, left: '56%', width: 2, background: 'var(--accent)' }} />
          </div>
        </WBField>
        <WBStatGrid items={[['Ink coverage', '7.8%', 'var(--exact)'], ['Specks', '12'], ['Bleed-through', 'none', 'var(--exact)'], ['Method', 'Sauvola']]} />
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122} stripTone="light">
        <BeforeAfter w={340} h={452} beforeTone="mid" afterTone="light" split={50} beforeLabel="GRAYSCALE" afterLabel="BILEVEL" />
      </WBViewer>
    }
  />
);

/* 05 · Dewarp — warp-mesh flatten */
const DewarpWB = () => (
  <WBLayout
    title="Page workbench · Dewarp"
    sub="Flatten page curl and gutter bow. The estimated warp mesh is overlaid on the source; tune density and strength, then preview the flattened result."
    applyLabel="Apply dewarp"
    left={
      <WBPanel label="Dewarp controls">
        <WBField label="Mesh density" hint="control points"><WBSlider value={14} min={4} max={40} tone="var(--ocr)" /></WBField>
        <WBField label="Correction strength"><WBSlider value={78} min={0} max={100} unit="%" tone="var(--ocr)" /></WBField>
        <WBToggleRow label="Detect spine curl" sub="Estimate gutter bow from text-line curvature" on={true} />
        <WBToggleRow label="Lock aspect ratio" sub="Preserve page proportions while flattening" on={true} />
        <WBStatGrid items={[['Max displacement', '34 px', 'var(--fuzzy)'], ['Lines used', '41'], ['Residual bow', '1.2 px', 'var(--exact)'], ['Reads', 'bilevel']]} />
        <WBNote tone="info">Dewarp reads the bilevel output from Threshold; line curvature drives the mesh so estimation stays robust on faded scans.</WBNote>
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122} toolbarExtra={<Button variant="ghost" size="sm" icon="refresh">Re-estimate</Button>}>
        <WBPage tone="light" cornerLabel="MESH · p0123"><MeshOverlay /></WBPage>
        <WBPage tone="light" cornerLabel="FLATTENED" cornerTone="var(--exact)" />
      </WBViewer>
    }
  />
);

/* 06 · Deskew — rotate to true rectangle */
const DeskewWB = () => (
  <WBLayout
    title="Page workbench · Deskew"
    sub="Rotate the page so its baselines run true horizontal. The detected angle comes from the text baselines shown in red; override it by hand if the auto-estimate fights an illustration-heavy page."
    applyLabel="Apply deskew"
    left={
      <WBPanel label="Deskew controls">
        <WBToggleRow label="Auto-detect angle" sub="From dominant text baselines" on={true} />
        <WBField label="Rotation" hint="degrees · cw"><WBSlider value={-2.4} min={-6} max={6} unit="°" tone="var(--mismatch)" /></WBField>
        <WBField label="Baseline source">
          <WBSegment active="text" options={[{ id: 'text', label: 'Text' }, { id: 'edges', label: 'Edges' }, { id: 'hough', label: 'Hough' }]} />
        </WBField>
        <WBStatGrid items={[['Detected', '−2.4°', 'var(--mismatch)'], ['Baselines', '38'], ['Std dev', '0.18°', 'var(--exact)'], ['After', '0.0°', 'var(--exact)']]} />
        <WBNote tone="good" title="Confident estimate">38 baselines agree within 0.18°. The correction is safe to apply across the run.</WBNote>
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122}>
        <WBPage tone="light" cornerLabel="SKEW · −2.4°" cornerTone="rgba(220,101,85,0.85)"><SkewGuides deg={-2.4} /></WBPage>
        <WBPage tone="light" cornerLabel="CORRECTED" cornerTone="var(--exact)"><SkewGuides deg={0} color="var(--exact)" /></WBPage>
      </WBViewer>
    }
  />
);

/* 07 · Post-transform crop — re-crop after dewarp/deskew */
const PostTransformCropWB = () => (
  <WBLayout
    title="Page workbench · Post-transform crop"
    sub="Dewarp and deskew leave blank rotation wedges at the corners. Re-crop tight to the rectified content so those wedges and any reintroduced margin are trimmed away."
    applyLabel="Apply re-crop"
    left={
      <WBPanel label="Re-crop controls">
        <WBToggleRow label="Trim rotation wedges" sub="Cut the triangular blanks left by deskew" on={true} />
        <WBField label="Edge padding" hint="px"><WBSlider value={18} min={0} max={80} unit="px" /></WBField>
        <WBField label="Snap to" >
          <WBSegment active="content" options={[{ id: 'content', label: 'Content' }, { id: 'prev', label: 'Prev box' }]} />
        </WBField>
        <WBStatGrid items={[['New box', '1942 × 3060'], ['Wedge trimmed', '2.1%', 'var(--fuzzy)'], ['vs rough crop', '−38 px'], ['Reads', 'deskewed']]} />
        <WBNote tone="info">Runs after dewarp + deskew so the content rectangle is final before layout analysis.</WBNote>
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122}>
        <WBPage tone="light" cornerLabel="RECTIFIED · p0123">
          {/* corner wedges */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderTop: '26px solid color-mix(in oklab, var(--mismatch) 30%, transparent)', borderRight: '34px solid transparent' }} />
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 0, height: 0, borderBottom: '26px solid color-mix(in oklab, var(--mismatch) 30%, transparent)', borderLeft: '34px solid transparent' }} />
          <CropFrame inset="7% 8%" label="re-crop · trims wedges" />
        </WBPage>
      </WBViewer>
    }
  />
);

/* 08 · Denoise — despeckle, protect marks */
const DenoiseWB = () => (
  <WBLayout
    title="Page workbench · Denoise"
    sub="Remove scanner speckle without eating real ink. Protected marks — punctuation, diacritics, fine serifs — are detected first (green) and held back from the despeckle pass."
    applyLabel="Apply denoise"
    left={
      <WBPanel label="Denoise controls">
        <WBField label="Aggressiveness"><WBSlider value={42} min={0} max={100} unit="%" /></WBField>
        <WBField label="Min speck size" hint="px² removed below"><WBSlider value={3} min={1} max={20} unit="px" /></WBField>
        <WBToggleRow label="Protect small marks" sub="Hold punctuation & diacritics from removal" on={true} />
        <WBToggleRow label="Despeckle margins only" sub="Leave the text column untouched" on={false} />
        <WBGroupLabel>Detected this page</WBGroupLabel>
        <WBStatGrid items={[['Specks removed', '218', 'var(--exact)'], ['Marks protected', '47', 'var(--exact)'], ['Largest removed', '5 px²'], ['Ink Δ', '−0.3%']]} />
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122}>
        <WBPage tone="light" cornerLabel="BEFORE · p0123"><ProtectMarks /></WBPage>
        <WBPage tone="light" cornerLabel="DENOISED" cornerTone="var(--exact)" />
      </WBViewer>
    }
  />
);

/* 12 · Post-OCR crop — content-aware, protect sidenotes */
const PostOcrCropWB = () => (
  <WBLayout
    title="Page workbench · Post-OCR crop"
    sub="Crop to the recognised content now that OCR knows where the text and marginalia sit. Sidenote zones detected during layout are protected so a tight crop never clips them."
    applyLabel="Apply crop"
    left={
      <WBPanel label="Crop controls">
        <WBToggleRow label="Protect sidenote zones" sub="From Page layout · keep marginalia in frame" on={true} />
        <WBField label="Content padding" hint="px"><WBSlider value={22} min={0} max={90} unit="px" /></WBField>
        <WBField label="Asymmetry" hint="extra outer margin"><WBSlider value={12} min={0} max={50} unit="px" /></WBField>
        <WBStatGrid items={[['Box', '1900 × 3010'], ['Sidenotes kept', '2', 'var(--exact)'], ['Outer margin', '+12 px'], ['Reads', 'OCR zones']]} />
        <WBNote tone="info">This page carries a left marginal note; the crop widens the outer margin to keep it whole.</WBNote>
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122}>
        <WBPage tone="light" cornerLabel="OCR'D · p0123">
          <OvBox t={26} l={6} w={20} h={22} color="var(--fuzzy)" label="sidenote · protected" fill={10} />
          <CropFrame inset="8% 7% 9% 4%" label="content + sidenote" />
        </WBPage>
      </WBViewer>
    }
  />
);

/* ====================================================================
   OCR / TEXT / PACK GROUP
==================================================================== */

/* 09 · Page layout — zones + reading order */
const PageLayoutWB = () => (
  <WBLayout
    title="Page workbench · Page layout"
    sub="Inspect the detected zones and reading order for this page. Re-type a misread region, redraw a box the detector missed, or reorder the flow — illustration zones here feed the Illustrations stage."
    applyLabel="Confirm layout"
    controlsWidth={320}
    left={
      <WBPanel label="Zones" sub="6 detected · reading order 1–6" badge={<Badge tone="clean">resolved</Badge>}>
        {[
          ['1', 'Running head', 'var(--ink-3)'],
          ['2', 'Heading', 'var(--word)'],
          ['3', 'Body text', 'var(--para)'],
          ['4', 'Marginalia', 'var(--fuzzy)'],
          ['5', 'Illustration', 'var(--gt)'],
          ['6', 'Caption', 'var(--line)'],
        ].map(([n, t, c], i) => (
          <WBListRow key={n} active={i === 2} tone={c} main={t} sub={'zone ' + n} right={<Icon name="grip" size={13} style={{ color: 'var(--ink-4)' }} />} />
        ))}
        <WBNote tone="info">Illustration zones (purple) are handed to the Illustrations stage for extraction. Redraw or merge zones with the editor on the page.</WBNote>
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122} toolbarExtra={<Button variant="ghost" size="sm" icon="plus">Draw zone</Button>}>
        <WBPage tone="light" w={360} h={478} cornerLabel="LAYOUT · p0123">
          <OvBox t={5} l={30} w={40} h={4} color="var(--ink-3)" num="1" />
          <OvBox t={11} l={14} w={72} h={7} color="var(--word)" num="2" />
          <OvBox t={20} l={14} w={54} h={38} color="var(--para)" num="3" />
          <OvBox t={22} l={72} w={16} h={20} color="var(--fuzzy)" num="4" />
          <OvBox t={61} l={20} w={56} h={24} color="var(--gt)" num="5" />
          <OvBox t={87} l={24} w={48} h={4} color="var(--line)" num="6" />
        </WBPage>
      </WBViewer>
    }
  />
);

/* 10 · OCR — glyph recognition + confidence */
const OcrWB = () => (
  <WBLayout
    title="Page workbench · OCR"
    sub="Review recognition on this page. Word boxes are tinted by confidence — green is clean, amber is uncertain, red is a likely miss. Pick a low-confidence token to see candidates and the cropped glyph."
    applyLabel="Accept page"
    controlsWidth={320}
    left={
      <WBPanel label="Low-confidence tokens" sub="this page · 387 words · 5 below 0.80" badge={<Badge tone="dirty">5</Badge>}>
        {[
          ['rҽmnant', 'remnant', '0.42', 'var(--mismatch)'],
          ['Surviv\u0250ls', 'Survivals', '0.61', 'var(--fuzzy)'],
          ['cl0ister', 'cloister', '0.55', 'var(--mismatch)'],
          ['thҽ', 'the', '0.74', 'var(--fuzzy)'],
          ['arrival\u017f', 'arrivals', '0.78', 'var(--fuzzy)'],
        ].map(([raw, sug, sc, c], i) => (
          <WBListRow key={i} active={i === 0} tone={c}
            main={<span className="mono">{raw} <span style={{ color: 'var(--ink-4)' }}>→</span> <span style={{ color: 'var(--ink-1)' }}>{sug}</span></span>}
            sub={'confidence ' + sc}
            right={<span className="mono" style={{ fontSize: 11, fontWeight: 700, color: c }}>{sc}</span>} />
        ))}
        <WBField label="Engine"><WBSelect value="Tesseract 5 · eng + lat" /></WBField>
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122} toolbarExtra={<Badge tone="ocr" mono>97.1% mean</Badge>}>
        <WBPage tone="light" w={340} h={452} cornerLabel="OCR · p0123">
          {[[16, 14, 40, 'var(--exact)'], [22, 14, 60, 'var(--exact)'], [28, 14, 34, 'var(--mismatch)'], [28, 52, 28, 'var(--exact)'], [34, 14, 56, 'var(--exact)'], [40, 14, 22, 'var(--fuzzy)'], [40, 40, 44, 'var(--exact)'], [46, 14, 50, 'var(--exact)'], [52, 14, 30, 'var(--mismatch)'], [58, 14, 62, 'var(--exact)']].map(([t, l, w, c], i) => (
            <div key={i} style={{ position: 'absolute', top: t + '%', left: l + '%', width: w + '%', height: '3.4%', border: '1px solid ' + c, background: 'color-mix(in oklab, ' + c + ' 14%, transparent)', borderRadius: 1 }} />
          ))}
        </WBPage>
      </WBViewer>
    }
  />
);

/* 15 · Wordcheck — suspicion sidecar */
const WordcheckWB = () => (
  <WBLayout
    title="Page workbench · Wordcheck"
    sub="The suspicion sidecar for this page: every flagged word in reading context, with its type and a suggested fix. Stealth scannos (real words used wrongly) are marked — accept, correct, or send to Text review."
    applyLabel="Clear page"
    controlsWidth={330}
    left={
      <WBPanel label="Suspects" sub="this page · 4 flagged · 1 stealth" badge={<Badge tone="dirty">4</Badge>}>
        {[
          ['cloiſter', 'cloister', 'scanno · long-s', 'var(--fuzzy)', true],
          ['arid', 'and', 'stealth · real word', 'var(--mismatch)', false],
          ['Belloe', 'Belloc', 'scanno · c/e', 'var(--fuzzy)', false],
          ['tlie', 'the', 'scanno · h/li', 'var(--fuzzy)', false],
        ].map(([raw, sug, type, c, active], i) => (
          <WBListRow key={i} active={active} tone={c}
            main={<span className="mono">{raw} <span style={{ color: 'var(--ink-4)' }}>→</span> <span style={{ color: 'var(--ink-1)' }}>{sug}</span></span>}
            sub={type}
            right={<div style={{ display: 'flex', gap: 4 }}><Button variant="ghost" size="sm" icon="check" /><Button variant="ghost" size="sm" icon="x" /></div>} />
        ))}
        <WBNote tone="warn" title="1 stealth scanno">“arid” is a valid word but the context wants “and”. Stealth misses never trip a plain spellcheck — confirm against the image.</WBNote>
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122} stripTone="light">
        <WBPage tone="light" w={272} h={362} cornerLabel="p0123" />
        <TextBlock w={300} lines={[
          [{ t: 'the old ' }, { t: 'cloiſter', hl: 'var(--fuzzy)' }, { t: ' walls, grey' }],
          [{ t: 'with age ' }, { t: 'arid', hl: 'var(--mismatch)' }, { t: ' worn by rain,' }],
          [{ t: 'stood as ' }, { t: 'Belloe', hl: 'var(--fuzzy)' }, { t: ' had left them,' }],
          [{ t: 'and ' }, { t: 'tlie', hl: 'var(--fuzzy)' }, { t: ' ivy climbing still' }],
          [{ t: 'across the broken arch.' }],
        ]} />
      </WBViewer>
    }
  />
);

/* 16 · Text review — human proof + comments */
const TextReviewWB = () => (
  <WBLayout
    title="Page workbench · Text review"
    sub="Final human read of this page against the scan. Edit the transcription inline, mark the page reviewed, or leave a comment for the next proofer. Diffs from the OCR text are underlined."
    applyLabel="Mark reviewed"
    applyIcon="check"
    controlsWidth={330}
    left={
      <WBPanel label="Review" badge={<Badge tone="dirty">in review</Badge>}>
        <WBField label="Page status">
          <WBSegment active="review" options={[{ id: 'review', label: 'Reviewing', tone: 'var(--fuzzy)' }, { id: 'ok', label: 'OK', tone: 'var(--exact)' }, { id: 'hold', label: 'Hold', tone: 'var(--mismatch)' }]} />
        </WBField>
        <WBToggleRow label="Show OCR diff" sub="Underline edits vs recognised text" on={true} />
        <WBGroupLabel right={<Button variant="ghost" size="sm" icon="plus" />}>Comments</WBGroupLabel>
        {[['AK', 'Long-s normalised in line 1 — matches project style.', '2m'], ['—', 'Check “arrivals” spelling against title page.', '8m']].map(([who, body, t], i) => (
          <div key={i} style={{ display: 'flex', gap: 9, padding: '8px 10px', background: 'var(--bg-sunk)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
            <div style={{ width: 22, height: 22, borderRadius: 99, flex: '0 0 auto', background: 'var(--bg-raised)', border: '1px solid var(--border-2)', display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 600, color: 'var(--ink-2)' }}>{who}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{body}</div>
              <div className="mono" style={{ marginTop: 3, fontSize: 9.5, color: 'var(--ink-4)' }}>{t} ago</div>
            </div>
          </div>
        ))}
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122} toolbarExtra={<Badge tone="review" mono>2 comments</Badge>}>
        <WBPage tone="light" w={272} h={362} cornerLabel="p0123" />
        <TextBlock w={300} lines={[
          [{ t: 'the old ' }, { t: 'cloister', hl: 'var(--exact)' }, { t: ' walls, grey' }],
          [{ t: 'with age ' }, { t: 'and', hl: 'var(--exact)' }, { t: ' worn by rain,' }],
          [{ t: 'stood as ' }, { t: 'Belloc', hl: 'var(--exact)' }, { t: ' had left them,' }],
          [{ t: 'and ' }, { t: 'the', hl: 'var(--exact)' }, { t: ' ivy climbing still' }],
          [{ t: 'across the broken arch.' }],
        ]} />
      </WBViewer>
    }
  />
);

/* 17 · Illustrations — per-page plate extraction */
const IllustWB = () => (
  <WBLayout
    title="Page workbench · Illustrations"
    sub="Extract the illustration zones detected during Page layout. Tune the crop box, keep plates as contone (not bilevel), and set the export so the figure lands clean in the proof pack."
    applyLabel="Extract plate"
    controlsWidth={330}
    left={
      <WBPanel label="Illustrations" sub="this page · 1 zone" badge={<Badge tone="ocr">contone</Badge>}>
        <WBListRow active tone="var(--gt)" main="fig-014 · woodcut" sub="zone 5 · 1180 × 880 px" right={<Badge tone="clean" mono>keep</Badge>} />
        <WBField label="Bleed padding" hint="px around zone"><WBSlider value={16} min={0} max={60} unit="px" tone="var(--gt)" /></WBField>
        <WBToggleRow label="Keep contone" sub="Skip bilevel — preserve grayscale tones" on={true} />
        <WBToggleRow label="Include caption" sub="Extend the crop to the caption below" on={false} />
        <WBField label="Export"><WBSelect value="PNG · 600 dpi · grayscale" /></WBField>
        <WBStatGrid items={[['Crop', '1212 × 912'], ['Mode', 'contone', 'var(--ocr)'], ['Output', 'fig-014.png'], ['DPI', '600']]} />
      </WBPanel>
    }
    viewer={
      <WBViewer stem="p0123" idx={122}>
        <WBPage tone="light" w={340} h={452} cornerLabel="LAYOUT · p0123">
          <OvBox t={30} l={20} w={56} h={26} color="var(--gt)" label="fig-014 · extract" fill={12} />
        </WBPage>
        <div style={{ width: 220, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Extracted plate</div>
          <div style={{ position: 'relative', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: 12 }}>
            <FakeThumb tone="mid" width={196} height={148} />
            <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ink-3)' }}>fig-014.png · 1212 × 912 · contone</div>
          </div>
        </div>
      </WBViewer>
    }
  />
);

/* ---------------------- Dispatch ---------------------- */
const WB_MAP = {
  crop: CropWB,
  threshold: ThresholdWB,
  dewarp: DewarpWB,
  deskew: DeskewWB,
  post_transform_crop: PostTransformCropWB,
  denoise: DenoiseWB,
  text_zones: PageLayoutWB,
  ocr: OcrWB,
  post_ocr_crop: PostOcrCropWB,
  wordcheck: WordcheckWB,
  text_review: TextReviewWB,
  illust: IllustWB,
};
const PageWorkbench = ({ stage }) => {
  const C = WB_MAP[stage];
  return C ? <C /> : null;
};

Object.assign(window, {
  CropWB, ThresholdWB, DewarpWB, DeskewWB, PostTransformCropWB, DenoiseWB,
  PageLayoutWB, OcrWB, PostOcrCropWB, WordcheckWB, TextReviewWB, IllustWB,
  PageWorkbench,
});
