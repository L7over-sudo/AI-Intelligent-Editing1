import { z } from "zod";

export const workspaceViewSchema = z.enum([
  "create",
  "projects",
  "cover",
  "chat",
  "search",
  "storyboard",
  "preview",
  "render",
  "export",
]);

export type WorkspaceView = z.infer<typeof workspaceViewSchema>;

const workspaceStateSchema = z.object({
  view: workspaceViewSchema,
  selectedProjectId: z.string(),
});

const sceneDraftSchema = z
  .object({
    narration: z.string().optional(),
    subtitle: z.string().optional(),
    visualPrompt: z.string().optional(),
  })
  .strict();

const projectWorkspaceStateSchema = z.object({
  selectedSceneIds: z.array(z.string()),
  expandedSceneIds: z.array(z.string()),
  selectedRenderOutputId: z.string(),
  sceneDrafts: z.record(z.string(), sceneDraftSchema),
});

export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export type ProjectWorkspaceState = z.infer<
  typeof projectWorkspaceStateSchema
>;

export const workspaceStateStorageKey = "stickmotion:workspace-state:v1";

export function projectWorkspaceStateStorageKey(projectId: string) {
  return `stickmotion:project-workspace-state:v1:${projectId}`;
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function parseStoredWorkspaceState(value: string | null) {
  const parsed = workspaceStateSchema.safeParse(parseJson(value));
  return parsed.success ? parsed.data : undefined;
}

export function parseStoredProjectWorkspaceState(value: string | null) {
  const parsed = projectWorkspaceStateSchema.safeParse(parseJson(value));
  return parsed.success ? parsed.data : undefined;
}
