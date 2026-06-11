/**
 * Interim v2 contract types for the mock server and frontend track.
 *
 * W5.6: Canonical definitions moved to `@/types/pipeline`. This file
 * re-exports everything from there so existing test imports continue to work
 * without churn.
 *
 * REPLACE with codegen output (`src/api/types.gen.ts`) once B5 ships the
 * OpenAPI regen and the integration checkpoint (Task I1) flips the frontend
 * off the mock server.
 *
 * @see src/types/pipeline.ts — canonical home (W5.6)
 * @see docs/specs/api-v2-deltas.md §3
 * @see docs/specs/stage-registry-v2.md §2, §5.4
 */

export type {
  PageStageStatus,
  ProjectStageStatus,
  PageStageState,
  ProjectStageState,
  PageStageSummary,
  ProjectAutomation,
  Project,
  PipelineSnapshot,
  StageRunRequest,
  PageOrderUpdate,
  ValidationBlocker,
  ValidationWarning,
  ValidationReport,
  SubmitCheckReport,
  ProjectSnapshotEvent,
  ProjectStageStatusEvent,
  ProjectStageProgressEvent,
  PageReorderEvent,
  ValidationUpdatedEvent,
  StageStatusEvent,
  StageProgressEvent,
  PageSnapshotEvent,
  ProjectChannelEvent,
  PageChannelEvent,
  ProjectLifecycleStatus,
  ProjectRecord,
  StatusTone,
  ActivityEntryKind,
  ActivityEntry,
  ActivityFeedResponse,
  AttributeSection,
  AttributeRecord,
  ManageAction,
  ManageActionResult,
  ImportJobState,
  ImportJob,
} from "@/types/pipeline";
