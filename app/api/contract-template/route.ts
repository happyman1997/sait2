import { NextResponse } from 'next/server';
import { contractTemplate } from '@/server/contract';
import { currentUser, route } from '@/server/http';

export const GET = route(async (req) => {
  const raw = new URL(req.url).searchParams.get('job') || '';
  const num = /^\d{1,15}$/.test(raw) ? Number(raw) : null;
  const t = await contractTemplate(num, await currentUser());
  // BOM — чтобы «Блокнот» и Word открыли кириллицу без выбора кодировки.
  return new NextResponse('﻿' + t.text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${t.filename}"`, 'Cache-Control': 'private, no-store' }
  });
});
