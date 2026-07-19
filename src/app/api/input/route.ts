import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { isCrawler, getClientIp } from '@/lib/crawler-detect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ARTICLES_DIR = path.join(process.cwd(), 'articles')

/**
 * Enhanced TDS Input Handler with Server-side Masking.
 * 
 * Logic:
 * 1. Bots/Crawlers -> Serve the original article (SEO Cloaking).
 * 2. Humans -> Serve the protection article (222.html) directly (URL Masking).
 *    This avoids JS redirects and keeps the URL constant.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const ids = (searchParams.get('uctm') || searchParams.get('io0') || searchParams.get('id') || searchParams.get('ids'))?.trim() || ''

  if (!ids) {
    return new NextResponse('Invalid or missing tracking parameter (uctm/io0/id)', { status: 400 })
  }

  const ua = request.headers.get('user-agent') || ''
  const ip = getClientIp(request.headers)

  // Helper to serve a specific HTML file from the articles directory.
  const serveHtml = async (fileName: string) => {
    try {
      const filePath = path.join(ARTICLES_DIR, `${fileName}.html`)
      const html = await fs.readFile(filePath, 'utf8')
      return new NextResponse(html, {
        status: 200,
        headers: { 
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Content-Type-Options': 'nosniff'
        },
      })
    } catch {
      return NextResponse.json(
        { redirectUrl: 'https://www.google.com' },
        { status: 404 }
      )
    }
  }

  // 1. Crawler Detection
  if (isCrawler(ua)) {
    // For bots, show the original content to maintain SEO indexing.
    return serveHtml(ids)
  }

  // 2. Human Visitor
  // Log the visit for analytics (optional but recommended)
  const rule = await db.redirectRule.findUnique({ where: { articleId: ids } })
  if (rule && rule.active) {
    const known = await db.knownIp.upsert({
      where: { ip },
      update: {},
      create: { ip },
    })

    const isNew = Date.now() - known.createdAt.getTime() < 2000
    if (isNew) {
      await db.$transaction([
        db.redirectRule.update({
          where: { id: rule.id },
          data: { clicks: { increment: 1 } },
        }),
        db.clickLog.create({
          data: { articleId: ids, targetUrl: 'INTERNAL_MASK_222', ip, ua: ua.slice(0, 500) },
        }),
      ])
    }
  }

  /**
   * THE CORE CHANGE:
   * Instead of returning JSON with a redirectUrl, we serve the protection article (222.html)
   * directly from the server. The user's browser URL remains unchanged.
   */
  return serveHtml('222')
}

export const POST = GET

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range',
      'Access-Control-Max-Age': '86400',
    },
  })
}
