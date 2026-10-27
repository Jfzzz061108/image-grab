// background.js：Service Worker，负责接收图片列表、存储、打开画廊页
'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 接收 content.js 提取的图片列表：存到 session 存储并打开画廊页
  if (msg.type === 'OPEN_GALLERY') {
    chrome.storage.session.set({ images: msg.images }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
      sendResponse({ ok: true });
    });
    return true; // 表示会异步调用 sendResponse
  }
  return false;
});

// 点击工具栏图标时，直接打开画廊页（可能为空，页面内会给出提示）
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
});
