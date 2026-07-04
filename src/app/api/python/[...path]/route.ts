import { NextRequest, NextResponse } from 'next/server';

export async function NEXT_METHOD(req: NextRequest, { params }: { params: { path: string[] } }) {
    // Falls back seamlessly if any env variable is missing
    const FASTAPI_BASE = process.env.FASTAPI_URL || process.env.NEXT_PUBLIC_API_BASE || "https://symbolic-math-backend.onrender.com";
    
    const subPath = params.path.join('/');
    const { searchParams } = new URL(req.url);
    const qs = searchParams.toString();
    
    const targetUrl = `${FASTAPI_BASE}/${subPath}${qs ? `?${qs}` : ''}`;

    try {
        let options: RequestInit = {
            method: req.method,
            headers: { 'Content-Type': 'application/json' }
        };

        // Pass body only for POST/PUT requests safely
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            const rawBody = await req.text();
            options.body = rawBody;
        }
        
        const response = await fetch(targetUrl, options);
        const data = await response.json();
        
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[Whiteboard Proxy] Failed to reach FastAPI:", error.message);
        return NextResponse.json(
            { error: "compute_server_unreachable", message: error.message },
            { status: 502 }
        );
    }
}

export { NEXT_METHOD as GET, NEXT_METHOD as POST, NEXT_METHOD as PUT, NEXT_METHOD as DELETE };