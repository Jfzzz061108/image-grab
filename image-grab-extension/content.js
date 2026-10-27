// content.js：在电商商品详情页注入「获取图片」按钮，并提取页面所有商品图片
(function () {
  'use strict';

  // 防止重复注入
  if (window.__imageGrabInjected) return;
  window.__imageGrabInjected = true;

  // 最小尺寸阈值（像素），小于该尺寸的图片会被过滤
  const MIN_SIZE = 100;

  // 常见图标 / 占位图 / logo 的 URL 关键词，用于过滤
  const FILTER_KEYWORDS = [
    'logo', 'icon', 'avatar', 'qrcode', 'qr-code', 'qr_code',
    'loading', 'placeholder', 'sprite', 'btn', 'button',
    'share', 'emoji', 'badge', 'cart', 'like', 'search'
  ];

  // 判断是否为商品详情页（只有详情页才注入按钮）
  function isDetailPage() {
    const url = location.href.toLowerCase();
    return (
      /item\.taobao\.com\/item/.test(url) ||
      /detail\.tmall\.com\/item/.test(url) ||
      /item\.jd\.com\/\d+/.test(url) ||
      /yangkeduo\.com\/goods/.test(url) ||
      /pinduoduo\.com\/goods/.test(url)
    );
  }

  if (!isDetailPage()) return;

  // 判断 URL 是否命中过滤关键词
  function isFiltered(url) {
    const lower = url.toLowerCase();
    return FILTER_KEYWORDS.some((k) => lower.includes(k));
  }

  // 把相对路径补全为绝对 URL
  function toAbsolute(src) {
    try {
      return new URL(src, location.href).href;
    } catch (e) {
      return null;
    }
  }

  // 从 srcset 中解析出最大尺寸的图片 URL
  function parseSrcset(srcset) {
    if (!srcset) return null;
    let best = null;
    let bestWidth = 0;
    srcset.split(',').forEach((part) => {
      const p = part.trim();
      const m = p.match(/^(\S+)\s+(\d+)w/);
      if (m) {
        const w = parseInt(m[2], 10);
        if (w > bestWidth) {
          bestWidth = w;
          best = m[1];
        }
      } else if (p && !best) {
        best = p.split(/\s+/)[0];
      }
    });
    return best;
  }

  // 从 background-image 样式中提取所有 url
  function extractBgUrls(style) {
    const urls = [];
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    let m;
    while ((m = re.exec(style)) !== null) {
      if (m[2]) urls.push(m[2]);
    }
    return urls;
  }

  // 收集页面所有商品图片，返回去重后的数组
  function collectImages() {
    const map = new Map(); // url -> {url, width, height}

    // 添加候选图片；trustSize 为 true 时才做尺寸过滤
    function add(url, width, height, trustSize) {
      if (!url) return;
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      const abs = toAbsolute(url);
      if (!abs) return;
      if (isFiltered(abs)) return;
      const w = width || 0;
      const h = height || 0;
      // 尺寸可信时才按最小尺寸过滤（懒加载图/背景图尺寸可能不可靠，先保留）
      if (trustSize && w > 0 && h > 0 && (w < MIN_SIZE || h < MIN_SIZE)) return;
      const existing = map.get(abs);
      // 去重：同一 URL 保留尺寸信息更大的那条
      if (!existing || (existing.width || 0) < w) {
        map.set(abs, { url: abs, width: w, height: h });
      }
    }

    // 1) 所有 <img> 标签（含懒加载属性）
    document.querySelectorAll('img').forEach((img) => {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      // 当前实际显示的图片，尺寸可信
      add(img.currentSrc || img.src, w, h, true);
      // 懒加载真实地址，尺寸可能未知（当前加载的可能是占位图）
      [
        img.getAttribute('data-src'),
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-original'),
        img.getAttribute('data-url'),
        img.getAttribute('data-echo'),
        parseSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'))
      ].forEach((src) => add(src, w, h, false));
    });

    // 2) 背景图（background-image）
    document.querySelectorAll('*').forEach((el) => {
      const style = getComputedStyle(el).backgroundImage;
      if (!style || style === 'none') return;
      const w = el.offsetWidth || 0;
      const h = el.offsetHeight || 0;
      extractBgUrls(style).forEach((url) => add(url, w, h, false));
    });

    // 3) <picture>/<source> 等标签
    document.querySelectorAll('source[src], source[srcset]').forEach((s) => {
      add(s.getAttribute('src') || parseSrcset(s.getAttribute('srcset')), 0, 0, false);
    });

    return Array.from(map.values());
  }

  // 创建右下角悬浮按钮
  function createButton() {
    if (document.getElementById('__image_grab_btn')) return;
    const btn = document.createElement('button');
    btn.id = '__image_grab_btn';
    btn.textContent = '获取图片';
    btn.addEventListener('click', onButtonClick);
    document.body.appendChild(btn);
  }

  // 点击按钮：提取图片并发送给后台
  function onButtonClick() {
    const images = collectImages();
    if (images.length === 0) {
      showToast('未找到商品图片，请确认当前是商品详情页');
      return;
    }
    chrome.runtime.sendMessage({ type: 'OPEN_GALLERY', images: images }, (resp) => {
      if (chrome.runtime.lastError) {
        showToast('扩展未就绪，请刷新页面后重试');
      }
    });
  }

  // 简易 toast 提示
  function showToast(msg) {
    let t = document.getElementById('__image_grab_toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '__image_grab_toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  // 等待 DOM 就绪后注入按钮
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createButton);
  } else {
    createButton();
  }
})();
