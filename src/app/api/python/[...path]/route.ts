/**
 * ═══════════════════════════════════════════════════════════════
 *   Whiteboard Engine — Next.js ↔ FastAPI Reverse Proxy
 *   Routes:  /api/python/*  →  http://127.0.0.1:8000/*
 * ═══════════════════════════════════════════════════════════════
 */

import { type NextRequest, NextResponse } from "next/server";

const FASTAPI_BASE =
  process.env.FASTAPI_URL || "http://127.0.0.1:8000";

async function proxyRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const subPath = path ? `/${path.join("/")}` : "/";

  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const targetUrl = `${FASTAPI_BASE}${subPath}${qs ? `?${qs}` : ""}`;

  let body: BodyInit | undefined;
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    body = await req.arrayBuffer();
  }

  const forwardHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (!["host", "connection", "transfer-encoding"].includes(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body,
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });
    responseHeaders.set("x-proxied-by", "whiteboard-engine-next");

    const responseBody = await upstream.arrayBuffer();

    return new NextResponse(responseBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown proxy error";
    console.error("[Whiteboard Proxy] Failed to reach FastAPI:", message);

    return NextResponse.json(
      {
        error: "compute_server_unreachable",
        detail:
          `Cannot reach FastAPI at ${FASTAPI_BASE}. ` +
          "Start the backend: cd backend && python main.py",
        upstream_error: message,
      },
      { status: 502 }
    );
  }
}

export const GET     = proxyRequest;
export const POST    = proxyRequest;
export const PUT     = proxyRequest;
export const PATCH   = proxyRequest;
export const DELETE  = proxyRequest;
export const HEAD    = proxyRequest;
export const OPTIONS = proxyRequest;

export const dynamic = "force-dynamic";
