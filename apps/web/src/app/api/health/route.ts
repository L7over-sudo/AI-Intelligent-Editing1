import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    service: "stickmotion-web",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}

