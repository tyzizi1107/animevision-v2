import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTENSION_MIME: Record<string, string> = {
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(_request: Request, context: { params: Promise<{ userId: string; filename: string }> }) {
  const { userId, filename } = await context.params;
  if (!/^[a-f0-9]{24}$/i.test(userId) || !/^[\w-]+\.(?:gif|png|jpe?g|webp)$/i.test(filename)) {
    return new NextResponse(null, { status: 404 });
  }
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  const mime = EXTENSION_MIME[extension];
  if (!mime) return new NextResponse(null, { status: 404 });

  try {
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(process.cwd(), "data", "account-avatars", userId, filename));
    } catch {
      bytes = await readFile(path.join(process.cwd(), "public", "images", "avatar", "custom", userId, filename));
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
