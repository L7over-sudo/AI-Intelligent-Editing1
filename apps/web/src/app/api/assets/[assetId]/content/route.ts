import { NextResponse } from "next/server";

import { getPrisma } from "@stickmotion/db";
import { parseHttpByteRange } from "@stickmotion/shared";
import { LocalObjectStore } from "@stickmotion/storage";

import { getCurrentUser } from "@/server/auth";
import { apiError } from "@/server/http";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

async function getOwnedAsset(assetId: string) {
  const user = await getCurrentUser();
  const asset = await getPrisma().asset.findFirst({
    where: {
      id: assetId,
      OR: [
        { project: { ownerId: user.id, deletedAt: null } },
        { voiceProfile: { ownerId: user.id } },
      ],
    },
  });
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  return asset;
}

async function getReadableAsset(assetId: string) {
  const user = await getCurrentUser();
  const asset = await getPrisma().asset.findFirst({
    where: {
      id: assetId,
      OR: [
        { project: { ownerId: user.id, deletedAt: null } },
        {
          projectId: null,
          kind: "SFX",
          source: { in: ["builtin-synthesized", "user-local-library"] },
          license: { not: null },
        },
      ],
    },
  });
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  return asset;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await context.params;
    const asset = await getReadableAsset(assetId);
    const objectStore = new LocalObjectStore();
    const bytes = await objectStore.get(asset.objectKey);
    const mediaSize = bytes.byteLength;
    const download = new URL(request.url).searchParams.get("download") === "1";
    const commonHeaders = {
      "content-type": asset.contentType,
      "content-disposition": `${download ? "attachment" : "inline"}; filename="stickmotion-${asset.id}"`,
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

export async function PUT(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await context.params;
    const asset = await getOwnedAsset(assetId);
    if (asset.source !== "user-upload") {
      throw new Error("ASSET_UPLOAD_NOT_ALLOWED");
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength <= 0 ||
      declaredLength > MAX_UPLOAD_BYTES
    ) {
      throw new Error("UPLOAD_SIZE_INVALID");
    }
    if (request.headers.get("content-type") !== asset.contentType) {
      throw new Error("UPLOAD_CONTENT_TYPE_INVALID");
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (
      bytes.byteLength !== declaredLength ||
      bytes.byteLength !== Number(asset.byteSize)
    ) {
      throw new Error("UPLOAD_SIZE_MISMATCH");
    }
    await new LocalObjectStore().put(asset.objectKey, bytes, asset.contentType);
    return NextResponse.json({ assetId: asset.id, stored: true });
  } catch (error) {
    return apiError(error);
  }
}
