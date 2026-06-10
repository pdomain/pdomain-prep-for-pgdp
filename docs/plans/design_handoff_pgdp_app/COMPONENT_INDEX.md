# Component index — pd-prep-for-pgdp final designs

_Auto-extracted 2026-06-10. Every top-level `const Name = …` / `function Name(…)` with a capitalized identifier, per file. `design-canvas.jsx` copies are prototype scaffolding (DesignCanvas/DCSection/DCArtboard) — do not port._

## Frequency table (identifiers in ≥2 files)

| Identifier | Files |
|---|---|
| `App` | 27 |
| `DC` | 27 |
| `DC_STATE_FILE` | 27 |
| `DCArtboard` | 27 |
| `DCArtboardFrame` | 27 |
| `DCCtx` | 27 |
| `DCEditable` | 27 |
| `DCFocusOverlay` | 27 |
| `DCPostIt` | 27 |
| `DCSection` | 27 |
| `DCViewport` | 27 |
| `DesignCanvas` | 27 |
| `Body` | 8 |
| `Card` | 8 |
| `Gate` | 8 |
| `Seg` | 8 |
| `SetRow` | 8 |
| `Stat` | 8 |
| `Toggle2` | 8 |
| `Tree` | 6 |
| `Segmented` | 5 |
| `SettingRow` | 5 |
| `SettingSlider` | 5 |
| `Check` | 3 |

## Per-file inventory

### `design-system/template.jsx`
`AppHeader` · `AppTemplate` · `Breadcrumb` · `ControlsPlaceholder` · `JobRow` · `JobsDrawer` · `JobsPill`

### `design-system/ui-base.jsx`
`AppFrame` · `Badge` · `Button` · `Divider` · `Icon` · `Input` · `KeyCap` · `PageHeader` · `ProjectListBackdrop` · `ServerFooter` · `StepDots` · `TopNav`

### `final/archive/app.jsx`
`App`

### `final/archive/archive-data.js`
`ARC_ITEMS`

### `final/archive/archive.jsx`
`ARCMain` · `ARCSettings` · `Body` · `Card` · `Check` · `Gate` · `Seg` · `SetRow` · `Stat` · `Toggle2` · `Tree`

### `final/archive/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/build_package/app.jsx`
`App`

### `final/build_package/build-package-data.js`
`BP_TREE`

### `final/build_package/build-package.jsx`
`BPMain` · `BPSettings` · `Body` · `Card` · `Check` · `Gate` · `Seg` · `SetRow` · `Stat` · `Toggle2` · `Tree`

### `final/build_package/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/canvas-nav.jsx`
`CANVAS_LINKS` · `CanvasNav`

### `final/canvas_map/app.jsx`
`App`

### `final/canvas_map/canvas-map-data.js`
`ASPECT_POINTS` · `CMAP_FLAGS` · `CMAP_FLAG_COUNTS` · `CMAP_ROWS` · `CMAP_SPREADS` · `CMAP_TOTALS_DONE` · `CMAP_TOTALS_REVIEW` · `CMAP_TOTALS_RUNNING` · `COMMON_CANVAS`

### `final/canvas_map/canvas-map.jsx`
`AspectScatter` · `CMAP_DENSITY` · `CanvasPageRender` · `CmFlagChip` · `CmRow` · `CmSeg` · `CmSlider` · `CmStatusDot` · `CmapBanner` · `CmapBulkBar` · `CmapCard` · `CmapOverview` · `CmapPages` · `CmapPlaceEditor` · `CmapSpreads` · `CmapStepSettings` · `CmapToolbar`

### `final/canvas_map/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/crop/app.jsx`
`App`

### `final/crop/crop-data.js`
`CROP_FLAGS` · `CROP_FLAG_COUNTS` · `CROP_ROWS` · `CROP_TOTALS_DONE` · `CROP_TOTALS_REVIEW` · `CROP_TOTALS_RUNNING`

### `final/crop/crop.jsx`
`BboxEditor` · `CROP_DENSITY` · `CropBanner` · `CropBulkBar` · `CropCard` · `CropOverview` · `CropPages` · `CropStepSettings` · `CropToolbar` · `CroppedThumb` · `FlagChip` · `MarginField` · `StatusDot`

### `final/crop/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/denoise/app.jsx`
`App`

### `final/denoise/denoise-data.js`
`DENOISE_DETECT` · `DENOISE_FLAGS` · `DENOISE_FLAG_COUNTS` · `DENOISE_ROWS` · `DENOISE_TOTALS_DONE` · `DENOISE_TOTALS_REVIEW` · `DENOISE_TOTALS_RUNNING` · `MARK_KINDS`

### `final/denoise/denoise.jsx`
`CleanPanel` · `CleanThumb` · `DENOISE_DENSITY` · `DenoiseBanner` · `DenoiseBulkBar` · `DenoiseCard` · `DenoiseOverview` · `DenoisePages` · `DenoiseReviewEditor` · `DenoiseStepSettings` · `DenoiseToolbar` · `DnFlagChip` · `DnStatusDot` · `FirstPassStrip` · `FootMark` · `MarkChip` · `NoisyPanel` · `ProtectPill` · `Segmented` · `SettingRow` · `SettingSlider`

### `final/denoise/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/deskew/app.jsx`
`App`

### `final/deskew/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/deskew/deskew-data.js`
`DESKEW_FLAGS` · `DESKEW_FLAG_COUNTS` · `DESKEW_ROWS` · `DESKEW_TOTALS_DONE` · `DESKEW_TOTALS_REVIEW` · `DESKEW_TOTALS_RUNNING`

### `final/deskew/deskew.jsx`
`DESKEW_DENSITY` · `DeskewBanner` · `DeskewBulkBar` · `DeskewCard` · `DeskewOverview` · `DeskewPage` · `DeskewPages` · `DeskewReviewEditor` · `DeskewStepSettings` · `DeskewThumb` · `DeskewToolbar` · `DkFlagChip` · `DkStatusDot` · `GuideLines` · `SegRowK` · `Segmented` · `SettingRow` · `SettingSlider`

### `final/dewarp/app.jsx`
`App`

### `final/dewarp/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/dewarp/dewarp-data.js`
`DEWARP_FLAGS` · `DEWARP_FLAG_COUNTS` · `DEWARP_ROWS` · `DEWARP_TOTALS_DONE` · `DEWARP_TOTALS_REVIEW` · `DEWARP_TOTALS_RUNNING`

### `final/dewarp/dewarp.jsx`
`CurvedLines` · `DEWARP_DENSITY` · `DewarpBanner` · `DewarpBulkBar` · `DewarpCard` · `DewarpOverview` · `DewarpPages` · `DewarpReviewEditor` · `DewarpStepSettings` · `DewarpThumb` · `DewarpToolbar` · `DwFlagChip` · `DwStatusDot` · `SegRow` · `Segmented` · `SettingRow` · `SettingSlider` · `WarpMesh`

### `final/grayscale/app.jsx`
`App`

### `final/grayscale/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/grayscale/grayscale.jsx`
`AdvancedParams` · `AdvancedParamsStacked` · `AutoDetectBanner` · `BackendChip` · `GRAY_PAGES` · `GrayThumb` · `GrayscaleBody` · `GrayscaleOverview` · `GrayscalePages` · `GrayscaleStatTile` · `GrayscaleStepSettings` · `GrayscaleSubhead` · `ModeCard` · `ModePill` · `ModeRowCompact` · `PROJECT_PAGES_GS` · `PageRender` · `PageViewer` · `SAMPLE_PAGE_GS` · `STANDARD_TIME_GS` · `StageControlsLeft`

### `final/hyphen_join/app.jsx`
`App`

### `final/hyphen_join/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/hyphen_join/hyphen.jsx`
`HJAfterView` · `HJBeforeView` · `HJDecisionCard` · `HJPageCaseRow` · `HJStateChip` · `HJStatusPill` · `HJ_CASE_BY_ID` · `HJ_COLLAPSE_IDS` · `HJ_PAGE_CASES` · `HJ_PAGE_ID` · `HJ_PAGE_IDX` · `HJ_PAGE_LINES` · `HJ_PAGE_PARAGRAPHS` · `HJ_STATES` · `HJ_STATES_BY_ID` · `HJ_STATUS_TONE` · `HyphenAutoJoined` · `HyphenBody` · `HyphenMismatch` · `HyphenOverview` · `HyphenPageWorkbench` · `HyphenStepSettings` · `HyphenSubhead` · `HyphenToggle` · `HyphenUndecided` · `SelectStub` · `ThresholdSlider`

### `final/hyphen_join/variations.jsx`
`AUTO_JOINED_WORDS` · `AutoJoinedList` · `AutoJoinedRow` · `BookContextLine` · `ContextSnippet` · `HYPHEN_RULES` · `HyphenCard` · `HyphenLibraryTab` · `HyphenRow` · `HyphenV1` · `HyphenV2` · `HyphenV3` · `HyphenV4` · `HyphenV5` · `InstanceLine` · `Kbd` · `LB` · `MISMATCHED` · `MismatchRow` · `MismatchedReportV4` · `NgramLink` · `NgramSparklineCell` · `NgramsBlock` · `PageBreak` · `PerBookFrame` · `Pip` · `PostBookNotesPreview` · `ProposalPills` · `QueueCase` · `QueueSidebar` · `ReportHeader` · `ReportStatTiles` · `RuleChip` · `RuleChipInline` · `SCANNOS` · `ScannosLibraryTab` · `ScannosTable` · `SectionHead` · `SettingsHyphens` · `SettingsPageFrame` · `SettingsScannos` · `Sparkline` · `StatTile` · `TagList` · `UNDECIDED_CASES` · `UndecidedListV1` · `UndecidedListV2` · `ViewToggle`

### `final/illustrations/app.jsx`
`App`

### `final/illustrations/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/illustrations/illustrations-data.js`
`ILL_COUNTS` · `ILL_ITEMS` · `ILL_KINDS`

### `final/illustrations/illustrations.jsx`
`Body` · `Card` · `Gate` · `ILGallery` · `ILMain` · `ILSettings` · `KindRow` · `Plate` · `Seg` · `SetRow` · `Stat` · `StatusChip` · `Toggle2`

### `final/ocr/app.jsx`
`App`

### `final/ocr/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/ocr/ocr-data.js`
`OCR_CONF_HIST` · `OCR_ENGINE` · `OCR_ENGINES` · `OCR_FLAGS` · `OCR_FLAG_COUNTS` · `OCR_LOWCONF_TOKENS` · `OCR_OVERRIDES` · `OCR_ROWS` · `OCR_SAMPLE_LINES` · `OCR_TOTALS_DONE` · `OCR_TOTALS_REVIEW` · `OCR_TOTALS_RUNNING`

### `final/ocr/ocr.jsx`
`OCR_DENSITY` · `OcFlagChip` · `OcRow` · `OcSeg` · `OcSlider` · `OcStatusDot` · `OcrBackendChip` · `OcrBanner` · `OcrCard` · `OcrOverview` · `OcrPages` · `OcrRecognition` · `OcrStepSettings` · `OcrThumb` · `OcrToolbar`

### `final/page_order/app.jsx`
`App` · `PU_TAB_ITEMS` · `PuShell`

### `final/page_order/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/page_order/naming.jsx`
`NM_BLANKS` · `NM_BLANK_MODES` · `NM_DEFAULT_CODES` · `NM_DEF_DIGITS` · `NM_FOLDS` · `NM_FOLD_TONE` · `NM_LEAVES` · `NM_SCHEMES` · `NM_SEG_COLOR` · `NM_TOTAL` · `NM_WIDTH` · `NameChip` · `NmField` · `NmRadioList` · `NmSeg` · `NmToggle` · `PoNaming`

### `final/page_order/page-order-unified.jsx`
`PU_FLAG` · `PU_GRID` · `PU_LEAVES_FLAT` · `PU_LENS` · `PU_OUTSEQ_TICKS` · `PU_RUN_TONE` · `PU_WINDOWS` · `PoWorkbench` · `PuAction` · `PuGrid` · `PuHeader` · `PuLedger` · `PuRibbon` · `PuSeg` · `PuSpine` · `PuStatus` · `PuToolbar`

### `final/page_order/page-order.jsx`
`PoBanner` · `PoFlagChip` · `PoMini` · `PoOverview` · `PoPages` · `PoRow` · `PoSeg` · `PoSequence` · `PoStepSettings`

### `final/page_order/page-roles.jsx`
`PrHeader` · `PrLeafTable` · `PrMini` · `PrOutlineSection` · `PrRoleChip` · `PrRunRow` · `PrStart` · `PrStat` · `PrStyleSelect` · `RolesList` · `RolesOutline` · `RolesRibbon`

### `final/page_order/po-data.js`
`PO_FLAGS` · `PO_FLAG_COUNTS` · `PO_ROWS` · `PO_TOTALS_DONE` · `PO_TOTALS_REVIEW` · `PO_TOTALS_RUNNING`

### `final/page_order/pr-data.js`
`PR_LEAVES_APPENDIX` · `PR_LEAVES_CAT` · `PR_LEAVES_PLATE` · `PR_ROLES` · `PR_RUNS` · `PR_STYLES` · `PR_TICKS` · `PR_TOTALS` · `PR_startInfo`

### `final/page_order/run-leaf.jsx`
`DDMenu` · `GRID_BASE` · `GRID_REORDER` · `LeafInspector` · `PoWorkbenchInspect` · `ProLedger` · `QuickEditView` · `RL_ROLE_OPTS` · `RUN_HOLD` · `RUN_LABEL` · `RUN_OPTS` · `RUN_TEXT` · `RlBulkBar` · `RlCheck` · `RlField` · `RlInput` · `RlMoveTo` · `RlSeg` · `RlSelectish` · `RlToggle` · `RowSelect` · `RunAddForm` · `RunEditCard` · `RunManageView` · `RunSpine` · `SpineHoldRow` · `SpineRunRow`

### `final/pipeline/app.jsx`
`App`

### `final/pipeline/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/pipeline/page-workbench-stages.jsx`
`CropWB` · `DenoiseWB` · `DeskewWB` · `DewarpWB` · `IllustWB` · `MeshOverlay` · `OcrWB` · `OvBox` · `PageLayoutWB` · `PageWorkbench` · `PostOcrCropWB` · `PostTransformCropWB` · `ProtectMarks` · `SkewGuides` · `TextBlock` · `TextReviewWB` · `ThresholdWB` · `WBGroupLabel` · `WBListRow` · `WB_MAP` · `WordcheckWB`

### `final/pipeline/page-workbench.jsx`
`BeforeAfter` · `CropFrame` · `WBActionsRight` · `WBField` · `WBInput` · `WBLayout` · `WBNote` · `WBPage` · `WBPanel` · `WBSegment` · `WBSelect` · `WBSlider` · `WBStatGrid` · `WBSubhead` · `WBToggleRow` · `WBViewer`

### `final/pipeline/pipeline-template.jsx`
`PipelineEmptySlot` · `PipelineTemplate` · `ProjectInfoBand` · `ProjectSettingsGeneralExample` · `ProjectSettingsTemplate` · `SAMPLE_PROJECT` · `STAGE_DEFS` · `STAGE_STATE` · `STAGE_TABS` · `StageStrip` · `TabsBand`

### `final/pipeline/project-settings.jsx`
`FieldRow` · `ProjectSettings_Bibliographic` · `ProjectSettings_Danger` · `ProjectSettings_Format` · `ProjectSettings_Members` · `ProjectSettings_PGDP` · `ProjectSettings_StageDefaults` · `ProjectSettings_Storage` · `SettingsCard` · `SettingsHeader` · `SettingsRow` · `Toggle`

### `final/post_ocr_crop/app.jsx`
`App`

### `final/post_ocr_crop/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/post_ocr_crop/poc-data.js`
`POC_FLAGS` · `POC_FLAG_COUNTS` · `POC_ROWS` · `POC_TOTALS_DONE` · `POC_TOTALS_REVIEW` · `POC_TOTALS_RUNNING`

### `final/post_ocr_crop/post-ocr-crop.jsx`
`ContentThumb` · `POC_DENSITY` · `PocBanner` · `PocBulkBar` · `PocCard` · `PocEditor` · `PocFlagChip` · `PocOverview` · `PocPages` · `PocRow` · `PocSeg` · `PocSlider` · `PocStatusDot` · `PocStepSettings` · `PocToolbar`

### `final/post_transform_crop/app.jsx`
`App`

### `final/post_transform_crop/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/post_transform_crop/post-transform-crop.jsx`
`PTC_DENSITY` · `PtcBanner` · `PtcBboxEditor` · `PtcBulkBar` · `PtcCard` · `PtcFlagChip` · `PtcOverview` · `PtcPages` · `PtcRow` · `PtcSeg` · `PtcSlider` · `PtcStatusDot` · `PtcStepSettings` · `PtcToolbar` · `TransformedThumb`

### `final/post_transform_crop/ptc-data.js`
`PTC_FLAGS` · `PTC_FLAG_COUNTS` · `PTC_ROWS` · `PTC_TOTALS_DONE` · `PTC_TOTALS_REVIEW` · `PTC_TOTALS_RUNNING`

### `final/projects/app.jsx`
`App`

### `final/projects/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/projects/post-import.jsx`
`AnchorProject` · `IMPORT_JOBS` · `PostImport_Drawer` · `PostImport_Rail` · `PostImport_Redirect`

### `final/projects/projects.jsx`
`AttributesPanel` · `CoverPlaceholder` · `PROJECTS` · `PipelineMini` · `ProjectsControls` · `ProjectsEmpty` · `ProjectsPage` · `STATUS`

### `final/proof_pack/app.jsx`
`App`

### `final/proof_pack/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/proof_pack/proof-pack-data.js`
`PP_TREE`

### `final/proof_pack/proof-pack.jsx`
`Body` · `Card` · `Gate` · `PPMain` · `PPSettings` · `Seg` · `SetRow` · `Stat` · `Toggle2` · `Tree`

### `final/regex/app.jsx`
`App`

### `final/regex/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/regex/regex-data.js`
`RX_COUNTS` · `RX_PREVIEW` · `RX_RULES`

### `final/regex/regex.jsx`
`Body` · `Card` · `DiffLine` · `Gate` · `Pat` · `RXMain` · `RXRules` · `RXSettings` · `RuleRow` · `RxStatus` · `Seg` · `SetRow` · `Stat` · `Toggle2`

### `final/scannocheck/app.jsx`
`App`

### `final/scannocheck/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/scannocheck/scanno-data.js`
`LIST_CANDIDATES` · `LIST_TOTALS` · `SCANNO_ROWS` · `SCANNO_SUSPECTS` · `SCANNO_TOTALS_DONE` · `SCANNO_TOTALS_REVIEW` · `SCANNO_TOTALS_RUNNING` · `SCANNO_TYPES` · `SCANNO_TYPE_COUNTS`

### `final/scannocheck/scannocheck.jsx`
`SCANNO_DENSITY` · `ScRow` · `ScSeg` · `ScSlider` · `ScStatusDot` · `ScTypeChip` · `ScannoBanner` · `ScannoCard` · `ScannoListBuilder` · `ScannoOverview` · `ScannoPages` · `ScannoStepSettings` · `ScannoSuspects` · `ScannoThumb`

### `final/source/app.jsx`
`App`

### `final/source/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/source/sample-data.js`
`SOURCE_FILES` · `SOURCE_TOTALS` · `SOURCE_TOTALS_DONE`

### `final/source/source.jsx`
`BulkBar` · `FakeThumb` · `FileToolbar` · `InsertDialog` · `InsertDivider` · `InsertedThumb` · `KIND_LABEL` · `SOURCE_ROLES` · `STATE_LABEL` · `SkeletonThumb` · `SourceBanner` · `SourceFiles` · `SourceMetadata` · `SourceOverview` · `SourcePageWorkbench` · `SourceStageControlsLeft` · `SourceStepSettings` · `SourceViewer` · `SourceWBSubhead` · `SrcPagePreview` · `SrcRoleSegment` · `SrcWBField` · `SrcWBInput` · `SrcWBSelect` · `TagChip` · `ThumbCard`

### `final/submit_check/app.jsx`
`App`

### `final/submit_check/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/submit_check/submit-check-data.js`
`SUB_CHECKS`

### `final/submit_check/submit-check.jsx`
`Body` · `Card` · `Check` · `Gate` · `SUBMain` · `SUBSettings` · `Seg` · `SetRow` · `Stat` · `Toggle2` · `Tree`

### `final/template/app.jsx`
`App`

### `final/template/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/text_review/app.jsx`
`App`

### `final/text_review/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/text_review/text-review-data.js`
`TR_COMMENTS` · `TR_QUEUE` · `TR_REASONS` · `TR_REASON_COUNTS` · `TR_REVIEWERS` · `TR_ROWS` · `TR_TOTALS_DONE` · `TR_TOTALS_REVIEW` · `TR_TOTALS_RUNNING`

### `final/text_review/text-review.jsx`
`TR_DENSITY` · `TrAvatar` · `TrBanner` · `TrCard` · `TrComments` · `TrOverview` · `TrPageThumb` · `TrPages` · `TrReasonChip` · `TrReviewQueue` · `TrRow` · `TrSeg` · `TrStatusDot` · `TrStepSettings`

### `final/text_zones/app.jsx`
`App`

### `final/text_zones/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/text_zones/text-zones-data.js`
`ZONE_FLAGS` · `ZONE_FLAG_COUNTS` · `ZONE_ROWS` · `ZONE_TEMPLATES` · `ZONE_TOTALS_DONE` · `ZONE_TOTALS_REVIEW` · `ZONE_TOTALS_RUNNING` · `ZONE_TYPES` · `ZONE_TYPE_COUNTS`

### `final/text_zones/text-zones-editors.jsx`
`SplitEditor` · `ToolIcon` · `ZoneEditor`

### `final/text_zones/text-zones.jsx`
`Segmented` · `SettingRow` · `SettingSlider` · `ZONE_DENSITY` · `ZnFlagChip` · `ZnStatusDot` · `ZoneBanner` · `ZoneBox` · `ZoneBulkBar` · `ZoneCard` · `ZoneLegend` · `ZoneOverview` · `ZonePageRender` · `ZonePages` · `ZoneStepSettings` · `ZoneThumb` · `ZoneToolbar`

### `final/threshold/app.jsx`
`App`

### `final/threshold/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/threshold/threshold-data.js`
`THRESH_FLAGS` · `THRESH_FLAG_COUNTS` · `THRESH_ROWS` · `THRESH_TOTALS_DONE` · `THRESH_TOTALS_REVIEW` · `THRESH_TOTALS_RUNNING`

### `final/threshold/threshold.jsx`
`BilevelPanel` · `BilevelThumb` · `GrayPanel` · `Histogram` · `MethodPill` · `Segmented` · `SettingRow` · `SettingSlider` · `THRESH_DENSITY` · `ThFlagChip` · `ThStatusDot` · `ThresholdBanner` · `ThresholdBulkBar` · `ThresholdCard` · `ThresholdOverview` · `ThresholdPages` · `ThresholdReviewEditor` · `ThresholdStepSettings` · `ThresholdToolbar`

### `final/validation/app.jsx`
`App`

### `final/validation/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/validation/validation-data.js`
`VAL_COUNTS` · `VAL_RULES`

### `final/validation/validation.jsx`
`Body` · `Card` · `Gate` · `Seg` · `SetRow` · `Stat` · `Toggle2` · `Tree` · `VALMain` · `VALSettings`

### `final/zip/app.jsx`
`App`

### `final/zip/design-canvas.jsx`
`DC` · `DCArtboard` · `DCArtboardFrame` · `DCCtx` · `DCEditable` · `DCFocusOverlay` · `DCPostIt` · `DCSection` · `DCViewport` · `DC_STATE_FILE` · `DesignCanvas`

### `final/zip/zip-data.js`
`ZIP_FILES`

### `final/zip/zip.jsx`
`Body` · `Card` · `Gate` · `Seg` · `SetRow` · `Stat` · `Toggle2` · `Tree` · `ZIPMain` · `ZIPSettings`
