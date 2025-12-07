import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  applyCors,
  applyNoCache,
  handleOptions,
  parseJsonBody,
  sendError,
  sendJson
} from '../_lib/http.js';
import { createBookmark, listBookmarks } from '../_lib/db.js';
import { getAuthFromRequest, requireAuth } from '../_lib/auth.js';

type BookmarkBody = {
  title?: string;
  url?: string;
  category?: string;
  description?: string;
  visible?: boolean;
};

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

// === 新增：抓取函数 ===
async function handleParse(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;
  
  if (!url || typeof url !== 'string') {
    return sendError(res, 400, 'Missing url parameter');
  }

  let targetUrl = url;
  if (!targetUrl.startsWith('http')) {
    targetUrl = `https://${targetUrl}`;
  }

  try {
    const response = await axios.get(targetUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const title = $('title').text().trim() || '';
    const description = $('meta[name="description"]').attr('content') || 
                        $('meta[property="og:description"]').attr('content') || 
                        '';

    sendJson(res, 200, {
      success: true,
      title: title,
      description: description.trim()
    });
  } catch (error: any) {
    console.error('Parse error:', error.message);
    // 失败也返回空数据，不报错
    sendJson(res, 200, { success: false, title: '', description: '' });
  }
}
// ====================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res, 'GET,POST,OPTIONS')) {
    return;
  }

  applyCors(res, 'GET,POST,OPTIONS');
  applyNoCache(res);

  // === 修改：路由分发逻辑 ===
  // 如果是 GET 请求且包含 action=parse 参数，则走抓取逻辑
  if (req.method === 'GET' && req.query.action === 'parse') {
    await handleParse(req, res);
    return;
  }
  // ========================

  if (req.method === 'GET') {
    try {
      console.log('获取书签');
      const auth = getAuthFromRequest(req);
      const allBookmarks = await listBookmarks();
      const visibleBookmarks = auth
        ? allBookmarks
        : allBookmarks.filter((item) => item.visible !== false);
      sendJson(res, 200, visibleBookmarks);
    } catch (error) {
      console.error('获取书签失败', error);
      sendError(res, 500, '获取书签失败');
    }
    return;
  }

  if (req.method === 'POST') {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }
    try {
      const body = await parseJsonBody<BookmarkBody>(req);
      const title = body.title?.trim();
      const url = body.url?.trim();

      if (!title || !url) {
        sendError(res, 400, '标题和链接不能为空');
        return;
      }

      const bookmark = await createBookmark({
        title,
        url: sanitizeUrl(url),
        category: body.category?.trim() || undefined,
        description: body.description?.trim() || undefined,
        visible: body.visible ?? true
      });
      sendJson(res, 201, bookmark);
    } catch (error) {
      console.error('新增书签失败', error);
      sendError(res, 500, '新增书签失败');
    }
    return;
  }

  sendError(res, 405, 'Method Not Allowed');
}
