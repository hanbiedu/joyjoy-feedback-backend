'use strict';
const express = require('express');
const {generateBlogReview} = require('../services/blogReviewGenerator');
const router = express.Router();
const hits = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = Number(process.env.BLOG_REVIEW_HOURLY_LIMIT || 10);
router.post('/generate', async (req,res) => {
  res.set('Cache-Control','no-store');
  // Existing global CORS is wildcard. Reject off-site browser origins at this route.
  const origin = req.get('Origin');
  const allowed = (process.env.BLOG_REVIEW_ALLOWED_ORIGINS || 'https://jo2jo2.co.kr,https://www.jo2jo2.co.kr').split(',').map(x=>x.trim());
  if (origin && !allowed.includes(origin)) return res.status(403).json({error:'허용되지 않은 사이트입니다.'});
  const now=Date.now();
  const key=req.ip || req.socket.remoteAddress || 'unknown';
  const entry=hits.get(key);
  const current=entry && now-entry.start<WINDOW_MS ? entry : {start:now,count:0};
  if (current.count>=MAX_PER_HOUR) return res.status(429).json({error:'잠시 후 다시 시도해 주세요.'});
  current.count++;
  hits.set(key,current);
  // prune expired entries to keep in-memory limit bounded
  if (hits.size>5000) for(const [k,v] of hits) if(now-v.start>=WINDOW_MS) hits.delete(k);
  try {return res.json(await generateBlogReview(req.body));}
  catch (err) {
    console.error('[BLOG_REVIEW]', err?.status || 500, err?.message);
    const status = [400,422,429,503].includes(err?.status) ? err.status : 502;
    return res.status(status).json({error:status===502?'AI 초안 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.':err.message});
  }
});
module.exports = router;
