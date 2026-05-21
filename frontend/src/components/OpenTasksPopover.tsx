/**
 * OpenTasksPopover — bell icon with badge that opens a floating task list
 * (M5 hi-fi §Bell / Open Tasks).
 *
 * Designed for the top-nav area.  Accepts a list of `Task` objects (pages
 * awaiting review) and an `onSelectTask` callback so callers can navigate
 * or highlight the selected page.
 *
 * Uses the `<Popover>` Radix wrapper from `ui/Popover` so focus-trapping,
 * Escape-to-close, and click-outside dismiss are all handled by Radix.
 */
import { Bell, CheckCircle } from "@/icons/local-shims";
import { Link } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/Popover";

interface Task {
  /** Unique identifier (page id, review queue id, etc.) */
  id: string;
  /** Human-readable label shown in the popover row (e.g. "Page 0001") */
  label: string;
  /** Route href for the "Review →" link */
  href: string;
}

export interface OpenTasksPopoverProps {
  tasks: Task[];
  onSelectTask: (task: Task) => void;
  /** Project name shown in the popover footer, if available */
  projectName?: string;
}

export function OpenTasksPopover({
  tasks,
  onSelectTask,
  projectName,
}: OpenTasksPopoverProps) {
  const count = tasks.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Open tasks"
          className="relative h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-slate-900 tabular-nums"
            >
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-80 rounded-lg border border-slate-200 bg-white shadow-lg ring-1 ring-slate-900/5 z-50 overflow-hidden p-0"
      >
        {/* header */}
        <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Open tasks
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {count > 0
                ? `${count} page${count === 1 ? "" : "s"} need review`
                : "Nothing to review"}
            </div>
          </div>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            M5
          </span>
        </div>

        {/* body */}
        {count === 0 ? (
          <div className="px-3.5 py-8 text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 mb-2">
              <CheckCircle className="h-5 w-5" aria-hidden />
            </div>
            <div className="text-sm text-slate-700">All caught up</div>
            <div className="text-xs text-slate-500 mt-0.5">
              No pages awaiting review.
            </div>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="px-3.5 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    {task.label}
                  </div>
                </div>
                <Link
                  to={task.href}
                  onClick={() => onSelectTask(task)}
                  className="text-xs font-medium text-slate-700 hover:text-slate-900 underline-offset-2 hover:underline whitespace-nowrap"
                >
                  Review →
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* footer */}
        {projectName && (
          <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500 truncate">
              {projectName}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
