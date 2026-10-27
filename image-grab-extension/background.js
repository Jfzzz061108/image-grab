// background.js：Service Worker，负责抓取当前页面图片、存储、打开画廊页
'use strict';

/* ------------------------------------------------------------
   注入到页面里执行的图片提取函数（必须自包含，不能引用外部变量）
   ------------------------------------------------------------ */
function collectImagesInPage() {
  const MIN_SIZE = 100;
  const FILTER_KEYWORDS = [
    'logo', 'icon', 'avatar', 'qrcode', 'qr-code', 'qr_code',
    'loading', 'placeholder', 'sprite', 'btn', 'button',
    'share', 'emoji', 'badge', 'cart', 'like', 'search'
  ];

  const isFiltered = (u) => {
    const l = String(u).toLowerCase();
    return FILTER_KEYWORDS.some((k) => l.includes(k));
  };

  const toAbs = (src) => {
    try { return new URL(src, location.href).href; } catch (e) { return null; }
  };

  const parseSrcset = (srcset) => {
    if (!srcset) return null;
    let best = null;
    let bestWidth = 0;
    srcset.split(',').forEach((part) => {
      const p = part.trim();
      const m = p.match(/^(\S+)\s+(\d+)w/);
      if (m) {
        const w = parseInt(m[2], 10);
        if (w > bestWidth) { bestWidth = w; best = m[1]; }
      } else if (p && !best) {
        best = p.split(/\s+/)[0];
      }
    });
    return best;
  };

  const extractBg = (style) => {
    const urls = [];
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    let m;
    while ((m = re.exec(style)) !== null) { if (m[2]) urls.push(m[2]); }
    return urls;
  };

  const map = new Map();

  const add = (url, w, h, trust) => {
    if (!url) return;
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    const abs = toAbs(url);
    if (!abs) return;
    if (isFiltered(abs)) return;
    const width = w || 0;
    const height = h || 0;
    if (trust && width > 0 && height > 0 && (width < MIN_SIZE || height < MIN_SIZE)) return;
    const ex = map.get(abs);
    if (!ex || (ex.width || 0) < width) {
      map.set(abs, { url: abs, width: width, height: height });
    }
  };

  document.querySelectorAll('img').forEach((img) => {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    add(img.currentSrc || img.src, w, h, true);
    [
      img.getAttribute('data-src'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-url'),
      img.getAttribute('data-echo'),
      parseSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'))
    ].forEach((s) => add(s, w, h, false));
  });

  document.querySelectorAll('*').forEach((el) => {
    const style = getComputedStyle(el).backgroundImage;
    if (!style || style === 'none') return;
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    extractBg(style).forEach((u) => add(u, w, h, false));
  });

  document.querySelectorAll('source[src], source[srcset]').forEach((s) => {
    add(s.getAttribute('src') || parseSrcset(s.getAttribute('srcset')), 0, 0, false);
  });

  return Array.from(map.values());
}

/* ------------------------------------------------------------
   把图片列表（和可选错误信息）写入 session 存储并打开画廊页
   ------------------------------------------------------------ */
function openGallery(images, error) {
  chrome.storage.session.set({ images: images || [], error: error || '' }, () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
  });
}

/* ------------------------------------------------------------
   方式一：通过 content.js 抓图（电商页面已注入，最可靠）
   ------------------------------------------------------------ */
function grabViaContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'GRAB_IMAGES' }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve(null); // content.js 未注入
      } else {
        resolve((resp && resp.images) || []);
      }
    });
  });
}

/* ------------------------------------------------------------
   方式二：运行时注入脚本抓图（兜底，适用于非电商页面）
   ------------------------------------------------------------ */
async function grabViaExecuteScript(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: collectImagesInPage
    });
    return { images: (results && results[0] && results[0].result) || [], error: '' };
  } catch (e) {
    const error = (e && e.message) ? e.message : String(e);
    return { images: [], error: error };
  }
}

/* ------------------------------------------------------------
   点击工具栏图标：先走 content.js，失败则运行时注入
   ------------------------------------------------------------ */
async function handleAction(tab) {
  if (!tab || tab.id == null) {
    openGallery([], '当前标签页不可用');
    return;
  }

  // 方式一：content.js
  const fromContent = await grabViaContentScript(tab.id);
  if (fromContent !== null) {
    openGallery(fromContent, fromContent.length === 0 ? '页面未找到商品图片（可能不是商品详情页）' : '');
    return;
  }

  // 方式二：executeScript 兜底
  const r = await grabViaExecuteScript(tab.id);
  openGallery(r.images, r.error);
}

// content.js 点击「获取图片」按钮：直接打开画廊
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_GALLERY') {
    openGallery(msg.images, msg.images.length === 0 ? '页面未找到商品图片' : '');
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

// 点击工具栏图标
chrome.action.onClicked.addListener((tab) => {
  handleAction(tab);
});
