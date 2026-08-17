import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        issues: error.issues,
      },
      { status: 400 },
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  if (message === "PROJECT_REVISION_CONFLICT") {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (message === "PROJECT_BUSY") {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (message === "RENDER_JOB_ACTIVE") {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (
    message === "PROJECT_NOT_FOUND" ||
    message === "SCENE_NOT_FOUND" ||
    message === "ASSET_NOT_FOUND" ||
    message === "RENDER_JOB_NOT_FOUND" ||
    message === "VOICE_PROFILE_NOT_FOUND" ||
    message === "CHARACTER_PROFILE_NOT_FOUND" ||
    message === "PROMPT_TEMPLATE_NOT_FOUND"
  ) {
    return NextResponse.json({ error: message }, { status: 404 });
  }

  if (
    message === "RENDER_SCENES_REQUIRED" ||
    message === "SCENE_IMAGES_REQUIRED" ||
    message === "SCENE_IMAGE_REQUIRED" ||
    message === "AI_IMAGE_MODE_REQUIRED"
  ) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (
    message === "VOICE_PROFILE_INVALID" ||
    message === "VOICE_PROFILE_PROVIDER_MISMATCH" ||
    message === "VOICE_PROFILE_NOT_READY" ||
    message === "VOICE_PROFILE_BUILTIN_READONLY"
  ) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  console.error("[api]", error);
  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "服务器暂时无法处理该请求" },
    { status: 500 },
  );
}
