import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. 设置跨域，允许前端调用
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. 获取 URL 参数
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // 补全协议
  let targetUrl = url;
  if (!targetUrl.startsWith('http')) {
    targetUrl = `https://${targetUrl}`;
  }

  try {
    // 3. 发起请求
    const response = await axios.get(targetUrl, {
      timeout: 8000, // 8秒超时
      headers: {
        // 伪装浏览器，防止部分网站拦截
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    // 4. 解析 HTML
    const $ = cheerio.load(response.data);
    const title = $('title').text().trim() || '';
    
    // 获取描述 (优先获取 meta description，其次是 og:description)
    const description = $('meta[name="description"]').attr('content') || 
                        $('meta[property="og:description"]').attr('content') || 
                        $('meta[name="twitter:description"]').attr('content') || 
                        '';

    return res.status(200).json({
      success: true,
      title: title,
      description: description.trim()
    });

  } catch (error: any) {
    console.error('Parse error:', error.message);
    // 即使失败也返回 success: false，避免前端报错
    return res.status(200).json({ 
      success: false, 
      title: '', 
      description: '' 
    });
  }
}
