import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { parseHttpByteRange } from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  try {
    const { profileId } = await context.params;
    const user = await getCurrentUser();
    const profile = await getPrisma().voiceProfile.findFirst({
      where: { id: profileId, ownerId: user.id },
      include: { asset: true },
    });
    if (!profile) throw new Error("VOICE_PROFILE_NOT_FOUND");

    const bytes = await new LocalObjectStore().get(profile.asset.objectKey);
    const mediaSize = bytes.byteLength;
    const commonHeaders = {
      "content-type": profile.asset.contentType,
      "content-disposition": `inline; filename="voice-${profile.id}"`,
      "cache-control": "private, no-store",
      "accept-ranges": "bytes",
    };
    let range;
    try {
      range = parseHttpByteRange(request.headers.get("range"), mediaSize);
    } catch {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...commonHeaders,
          "content-range": `bytes */${mediaSize}`,
        },
      });
    }

    if (range) {
      const rangedBytes = bytes.subarray(range.start, range.end + 1);
      return new NextResponse(Buffer.from(rangedBytes), {
        status: 206,
        headers: {
          ...commonHeaders,
          "content-length": String(rangedBytes.byteLength),
          "content-range": `bytes ${range.start}-${range.end}/${mediaSize}`,
        },
      });
    }

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        ...commonHeaders,
        "content-length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
