/**
 * ProjectsEmpty — full-width hero for first-time user / no projects.
 *
 * DCArtboard: "Empty state" in final/projects/projects.jsx (ProjectsEmpty).
 * data-testid="projects-empty" is the fixture anchor.
 */

import { Button } from "@/components/ui/Button";

export function ProjectsEmpty({ onNewProject }: { onNewProject: () => void }) {
  return (
    <div
      className="flex flex-1 items-center justify-center p-12"
      data-testid="projects-empty"
      data-screen-label="ProjectsEmpty"
    >
      <div className="flex max-w-lg flex-col items-center gap-6 text-center">
        {/* Iconographic stack of pages */}
        <div className="relative h-24 w-36" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute rounded border border-border-2 bg-bg-surface shadow-sm"
              style={{
                left: 30 + i * 14,
                top: 14 - i * 6,
                width: 78,
                height: 100 - i * 4,
                opacity: 1 - i * 0.18,
                transform: `rotate(${(i - 1) * 4}deg)`,
              }}
            >
              <div
                className="absolute"
                style={{
                  inset: 12,
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, var(--border-1) 0 1px, transparent 1px 8px)",
                }}
              />
            </div>
          ))}
        </div>

        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink-1">
            No projects yet
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-3">
            A project bundles a book&apos;s pages, settings, and pipeline state
            — everything needed to assemble a PGDP-ready package. Start by
            uploading a folder of scans, or paste a source URL from archive.org.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="primary"
            data-testid="empty-new-project-btn"
            onClick={onNewProject}
          >
            Create new project
          </Button>
          <Button variant="outline" data-testid="empty-paste-url-btn">
            Paste source URL
          </Button>
        </div>

        <div className="flex w-full items-center justify-center gap-4 border-t border-border-1 pt-5 text-xs text-ink-3">
          <a
            href="#import"
            className="hover:text-ink-1"
            data-testid="import-archive-link"
          >
            Import a .pgdp-prep archive
          </a>
          <span className="text-border-2">·</span>
          <a
            href="#style-guide"
            className="hover:text-ink-1"
            data-testid="style-guide-link"
          >
            Open the format style guide
          </a>
        </div>
      </div>
    </div>
  );
}
