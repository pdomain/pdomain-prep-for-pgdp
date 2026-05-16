# Workflow: Folder Upload (P0.3)

**Priority:** P0 — blocks real Internet Archive books (most common source)
**Affects:** `01-new-project.md` CreateProjectModal (step 2 redesign)
**Audience:** Content provider

## Problem

Internet Archive downloads are folders of JP2 or PNG files, not zip archives.
The user must manually zip them before uploading — error-prone, slow on 400-page books,
and unexpected for new users.

## Goal

Accept a folder of image files directly from the user's filesystem, without requiring
them to zip it first.

## Actor & Entry Points

- **Who:** Content provider creating a new project
- **Enters from:** CreateProjectModal step 2 (currently "Upload zip")

## Step-by-Step Flow

1. User clicks "+ New Project", enters book name, clicks Next.
2. Upload step shows two options: "Upload zip" (existing) or "Select folder" (new).
3. User clicks "Select folder" → OS file picker opens with directory selection enabled (`webkitdirectory` attribute).
4. User selects the IA download folder (contains 400 JP2 files).
5. Browser shows file count + total size: "387 files, 2.1 GB — ready to upload".
6. User clicks "Start Upload".
7. Browser zips files client-side (JSZip, streaming, with progress) OR sends as multipart batch.
   Progress bar shows "Zipping… 43%" then "Uploading… 71%".
8. On completion, ingest fires automatically (same as zip path).

## Happy Path Mockup Spec

### Step 2 — Source Upload (redesigned)

Two-up card layout within the dialog (560px wide):

- Left card: "Zip archive" — cloud-upload icon, "Drag a .zip here or click to browse",
  "Up to 200 MB", dashed border. Currently implemented path.
- Right card: "Folder of images" — folder icon, "Select a folder of JP2 / PNG / JPG files",
  "JP2, PNG, JPG supported", dashed border. New path.

Both cards same height (~140px). Selected card gets accent border + checkmark badge.

After folder selected (before upload):

- File count badge: "387 files selected"
- Total size: "2.1 GB"
- File type summary: "JP2 (380), PNG (7)"
- Warning if any unrecognized extensions: amber badge "3 files will be skipped"
- "Start Upload" primary button (full-width, bottom of dialog)

During upload (folder path):

- Progress bar replaces card area
- Two-line status: "Preparing files…" (zipping phase) / "Uploading…" (transfer phase)
- Percentage + bytes transferred
- "Cancel" ghost button

## Edge Cases & Error States

- Folder contains no image files → "No supported image files found in this folder"
- Folder > 5 GB → warning: "Large folder — upload may take several minutes"
- Mixed folder + zip drag → "Please select either a folder or a zip, not both"
- User selects a file instead of folder → "Please select a folder, not a file"
- Upload interrupted → "Upload paused — Resume or Start over" with resume button

## Open Design Questions

- Should folder upload zip client-side (JSZip) or send raw multipart?
- For local-mode only: offer a "Use local path" option (type a filesystem path)?
- Should the file-count preview show a sortable list of detected filenames?

## Constraints

- `webkitdirectory` is Chrome/Firefox/Edge only; Safari has partial support.
- Zip files must use `.zip` extension for PGDP.
- Max zip size 200 MB (PGDP constraint) — client should warn if output zip will exceed.
