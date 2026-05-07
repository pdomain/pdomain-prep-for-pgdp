// Auto-generated from /openapi.json by `make openapi-export`.
// Until the backend is running, this file holds a hand-written subset that
// covers the surfaces the SPA exercises. Once the backend is up, run:
//   make openapi-export
// and this file will be regenerated.

export type PageType = "normal" | "blank" | "plate_b" | "plate_p" | "plate_r";
export type AlignmentOverride = "default" | "top" | "center" | "bottom";
export type PageProcessingStatus = "pending" | "processing" | "complete" | "error";
export type ProjectStatus =
  | "ingesting"
  | "configuring"
  | "processing"
  | "reviewing"
  | "packaging"
  | "complete";

export interface ProjectConfig {
  book_name: string;
  source_uri: string;
  proof_start_idx0: number;
  proof_end_idx0: number;
  cover_idx0: number | null;
  title_idx0: number | null;
  frontmatter_start_idx0: number;
  frontmatter_end_idx0: number;
  bodymatter_start_idx0: number;
  bodymatter_end_idx0: number;
  frontmatter_page_nbr_start: number;
  bodymatter_page_nbr_start: number;
  initial_crop_all: [number, number, number, number];
  ocr_crop_top: number;
  ocr_crop_bottom: number;
  ocr_crop_left: number;
  ocr_crop_right: number;
  custom_regex_passes: [string, string][];
  custom_scannos: Record<string, string>;
  layout_category_overrides: Record<string, string | null>;
  default_overrides: Record<string, unknown>;
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status: ProjectStatus;
  page_count: number;
  proof_page_count: number;
  config: ProjectConfig;
  storage_prefix: string;
  archived: boolean;
}

export interface CreateProjectRequest {
  name: string;
  source_type: "zip" | "s3_folder" | "local_folder";
  source_uri?: string | null;
}

export interface CreateProjectResponse {
  project: Project;
  upload_url?: string | null;
  upload_key?: string | null;
}

export interface PageConfigOverrides {
  initial_crop?: [number, number, number, number] | null;
  white_space_additional?: [number, number, number, number] | null;
  threshold_level?: number | null;
  fuzzy_pct?: number | null;
  pixel_count_columns?: number | null;
  pixel_count_rows?: number | null;
  skip_auto_deskew?: boolean | null;
  deskew_before_crop?: number | null;
  deskew_after_crop?: number | null;
  do_morph?: boolean | null;
  skip_denoise?: boolean | null;
  use_ocr_bbox_edge?: boolean | null;
  rotated_standard?: boolean | null;
  single_dimension_rescale?: boolean | null;
}

export interface PageRecord {
  project_id: string;
  idx0: number;
  prefix: string;
  source_stem: string;
  ignore: boolean;
  page_type: PageType;
  alignment: AlignmentOverride;
  config_overrides: PageConfigOverrides;
  splits: unknown[];
  illustration_regions: unknown[];
  source_key: string | null;
  thumbnail_key: string | null;
  processed_image_key: string | null;
  ocr_image_key: string | null;
  processing_status: PageProcessingStatus;
  processing_job_id: string | null;
  processing_error: string | null;
}

export interface ListPagesResponse {
  pages: PageRecord[];
  next_cursor: string | null;
  total: number;
}

export interface UpdatePageRequest {
  page_type?: PageType | null;
  alignment?: AlignmentOverride | null;
  config_overrides?: PageConfigOverrides | null;
  splits?: unknown[] | null;
  illustration_regions?: unknown[] | null;
}

/**
 * Response from `GET /api/data/projects/{id}/source-preview` (P2 #8).
 * Cheap thumbnail-strip backing — reads only the zip's central directory.
 */
export interface SourcePreviewResponse {
  filenames: string[];
  total_image_count: number;
}

export interface SystemDefaults {
  text_threshold: number;
  page_h_w_ratio: number;
  default_fuzzy_pct: number;
  default_pixel_count_columns: number;
  default_pixel_count_rows: number;
  ocr_engine: "doctr" | "tesseract";
  ocr_model_key: string | null;
  ocr_dpi: number;
  ocr_bbox_edge_min_words: number;
  layout_detector: "none" | "contour" | "pp-doclayout-plus-l";
  layout_detector_confidence: number;
  layout_checkpoint: string | null;
  standard_scannos: Record<string, string>;
  hyphenation_join_list: string[];
}
