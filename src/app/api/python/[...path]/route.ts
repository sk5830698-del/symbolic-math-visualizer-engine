import { NextRequest, NextResponse } from 'next/server';

async function handleProxy(req: NextRequest, params: { path: string[] }) {
    // Hardcoded production backup fallback direct string me hai ab
    const FASTAPI_BASE = process.env.FASTAPI_URL || process.env.NEXT_PUBLIC_API_BASE || "https://symbolic-math-backend.onrender.com";
    
    const subPath = (params.path || []).join('/');
    const { searchParams } = new URL(req.url);
    const qs = searchParams.toString();
    
    const targetUrl = `${FASTAPI_BASE}/${subPath}${qs ? `?${qs}` : ''}`;

    try {
        const method = req.method;
        const headers = { 'Content-Type': 'application/json' };
        
        let body: string | undefined = undefined;
        if (method !== 'GET' && method !== 'HEAD') {
            body = await req.text();
        }
        
        const response = await fetch(targetUrl, {
            method,
            headers,
            body
        });

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[Whiteboard Proxy] Error:", error?.message || error);
        return NextResponse.json(
            { error: "compute_server_unreachable", message: error?.message || "Connection failed" },
            { status: 502 }
        );
    }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
    return handleProxy(req, params);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
    return handleProxy(req, params);
}

export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
    return handleProxy(req, params);
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
    return handleProxy(req, params);
}