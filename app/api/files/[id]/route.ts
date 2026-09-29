import { NextResponse } from 'next/server';
import { readFile } from '@/server/files';
import { currentUser, route } from '@/server/http';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return route(async () => {
    const f = await readFile(id, await currentUser());
    return new NextResponse(new Uint8Array(f.data), {
      headers: { 'Content-Type': f.mime, 'Cache-Control': f.cache, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }
    });
  })(req);
}
