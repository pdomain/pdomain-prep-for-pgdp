import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import {
  fetchAllTier,
  saveAllTier,
  type StageValues,
} from "@/services/stageTiers";
import { ControlEditor } from "./StageControls";
import { getStageSchema } from "./stageSchemas";

function StageSettingsAllForm({
  stageId,
  stored,
}: {
  stageId: string;
  stored: StageValues;
}): ReactNode {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(stored);
  const save = useMutation({
    mutationFn: () => saveAllTier(stageId, values),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["stage-settings-all", stageId],
      }),
  });
  const schema = getStageSchema(stageId);

  return (
    <div
      data-testid={`settings-all-${stageId}`}
      className="flex flex-col gap-2"
    >
      <ControlEditor
        controls={schema?.controls ?? []}
        values={values}
        onPatch={(patch) => {
          setValues((previous) => ({ ...previous, ...patch }));
        }}
      />
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() => {
            save.mutate();
          }}
          data-testid={`settings-all-${stageId}-save`}
        >
          Save app default
        </Button>
        {save.isError && (
          <span className="text-sm text-status-error">
            {save.error.message}
          </span>
        )}
      </div>
    </div>
  );
}

/** App-wide defaults for one image stage, applied where no project or page sets a field. */
export function StageSettingsAllSection({
  stageId,
}: {
  stageId: string;
}): ReactNode {
  const stored = useQuery({
    queryKey: ["stage-settings-all", stageId],
    queryFn: () => fetchAllTier(stageId),
  });

  if (stored.isError) {
    return (
      <span className="text-sm text-status-error">{stored.error.message}</span>
    );
  }
  if (!stored.data) return null;
  // A saved value remounts the form so its local edits start from the stored tier.
  return (
    <StageSettingsAllForm
      key={JSON.stringify(stored.data)}
      stageId={stageId}
      stored={stored.data}
    />
  );
}
