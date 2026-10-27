// gallery.js：画廊页逻辑——展示图片、勾选、批量转 PNG / 打包 ZIP 下载
'use strict';

let images = [];
const selected = new Set();

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const totalCount = document.getElementById('totalCount');
const selectedCount = document.getElementById('selectedCount');
const downloadPngBtn = document.getElementById('downloadPngBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const selectAllBtn = document.getElementById('selectAll');
const invertBtn = document.getElementById('invert');
const progress = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const toast = document.getElementById('toast');

// 简单的 HTML 转义，防止 URL 中的特殊字符破坏结构
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 读取图片列表并渲染
chrome.storage.session.get('images', (data) => {
  images = data.images || [];
  render();
});

function render() {
  totalCount.textContent = images.length;
  grid.innerHTML = '';

  const hasImages = images.length > 0;
  empty.hidden = hasImages;
  grid.hidden = !hasImages;
  downloadPngBtn.disabled = !hasImages;
  downloadZipBtn.disabled = !hasImages;
  selectAllBtn.disabled = !hasImages;
  invertBtn.disabled = !hasImages;

  if (!hasImages) return;

  images.forEach((img, i) => {
    const sizeText = (img.width > 0 && img.height > 0) ? `${img.width} × ${img.height}` : '尺寸未知';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <label class="card-inner">
        <div class="img-wrap">
          <img src="${escapeHtml(img.url)}" loading="lazy" referrerpolicy="no-referrer" alt="图片 ${i + 1}">
        </div>
        <div class="card-meta">
          <span class="size">${sizeText}</span>
          <span class="idx">#${String(i + 1).padStart(3, '0')}</span>
        </div>
        <input type="checkbox" class="chk" data-index="${i}">
      </label>
    `;
    card.querySelector('.chk').addEventListener('change', (e) => {
      if (e.target.checked) selected.add(i);
      else selected.delete(i);
      updateSelected();
    });
    grid.appendChild(card);
  });

  updateSelected();
}

function updateSelected() {
  selectedCount.textContent = selected.size;
}

// 全选
selectAllBtn.addEventListener('click', () => {
  grid.querySelectorAll('.chk').forEach((chk) => {
    chk.checked = true;
    selected.add(parseInt(chk.dataset.index, 10));
  });
  updateSelected();
});

// 反选
invertBtn.addEventListener('click', () => {
  grid.querySelectorAll('.chk').forEach((chk) => {
    chk.checked = !chk.checked;
    const i = parseInt(chk.dataset.index, 10);
    if (chk.checked) selected.add(i);
    else selected.delete(i);
  });
  updateSelected();
});

// 下载按钮
downloadPngBtn.addEventListener('click', downloadPng);
downloadZipBtn.addEventListener('click', downloadZip);

// 取已选索引并升序排列
function getSelectedSorted() {
  return Array.from(selected).sort((a, b) => a - b);
}

// 下载期间锁定按钮、显示进度条
function setBusy(busy) {
  downloadPngBtn.disabled = busy;
  downloadZipBtn.disabled = busy;
  selectAllBtn.disabled = busy;
  invertBtn.disabled = busy;
  progress.hidden = !busy;
}

/* ------------------------------------------------------------
   1) 单张下载为 PNG
   ------------------------------------------------------------ */
async function downloadPng() {
  const indexes = getSelectedSorted();
  if (indexes.length === 0) {
    showToast('请先勾选要下载的图片');
    return;
  }

  setBusy(true);
  let done = 0;
  let fail = 0;

  for (let k = 0; k < indexes.length; k++) {
    const filename = `商品图_${String(k + 1).padStart(3, '0')}.png`;
    try {
      const blob = await toPngBlob(images[indexes[k]].url);
      await downloadBlob(blob, filename);
      done++;
    } catch (e) {
      fail++;
    }
    updateProgress(done, fail, indexes.length);
  }

  setBusy(false);
  showToast(`下载完成：成功 ${done} 张，失败 ${fail} 张`);
}

/* ------------------------------------------------------------
   2) 多张打包为 ZIP
   ------------------------------------------------------------ */
async function downloadZip() {
  const indexes = getSelectedSorted();
  if (indexes.length === 0) {
    showToast('请先勾选要打包的图片');
    return;
  }

  setBusy(true);
  const files = [];
  let done = 0;
  let fail = 0;

  for (let k = 0; k < indexes.length; k++) {
    const name = `商品图_${String(k + 1).padStart(3, '0')}.png`;
    try {
      const blob = await toPngBlob(images[indexes[k]].url);
      const data = new Uint8Array(await blob.arrayBuffer());
      files.push({ name: name, data: data });
      done++;
    } catch (e) {
      fail++;
    }
    updateProgress(done, fail, indexes.length);
  }

  // 打包成一个 ZIP 并下载
  if (files.length > 0) {
    try {
      const zip = buildZip(files);
      const zipBlob = new Blob([zip], { type: 'application/zip' });
      await downloadBlob(zipBlob, '商品图_打包.zip');
    } catch (e) {
      fail = indexes.length;
    }
  }

  setBusy(false);
  showToast(fail === 0 ? `已打包 ${done} 张图片为 ZIP` : `打包完成：成功 ${done} 张，失败 ${fail} 张`);
}

/* ------------------------------------------------------------
   把远程图片转换为 PNG 格式的 Blob
   ------------------------------------------------------------ */
async function toPngBlob(url) {
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error('fetch 失败');
  const blob = await resp.blob();

  // 优先使用 createImageBitmap（性能更好）
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return await canvasToBlob(canvas);
  }

  // 降级：用 Image 元素加载
  const objUrl = URL.createObjectURL(blob);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = objUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  URL.revokeObjectURL(objUrl);
  return await canvasToBlob(canvas);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('转换 PNG 失败'))), 'image/png');
  });
}

/* ------------------------------------------------------------
   直接下载 Blob（object URL）
   ------------------------------------------------------------ */
function downloadBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(blob);
    chrome.downloads.download({ url: objUrl, filename: filename, saveAs: false }, () => {
      if (chrome.runtime.lastError) {
        URL.revokeObjectURL(objUrl);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        // 给下载流程留出时间后再释放 object URL
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
        resolve();
      }
    });
  });
}

/* ------------------------------------------------------------
   原生生成 ZIP（stored 无压缩模式，PNG 本身已压缩，无需二次压缩）
   ------------------------------------------------------------ */
function buildZip(files) {
  // files: [{ name: string, data: Uint8Array }]
  const encoder = new TextEncoder();
  const chunks = [];       // 文件数据区
  const central = [];      // 中央目录区
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    // —— Local File Header（本地文件头，30 字节 + 文件名） ——
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // 签名
    lv.setUint16(4, 20, true);           // 所需版本
    lv.setUint16(6, 0x0800, true);       // 通用标志：UTF-8 文件名
    lv.setUint16(8, 0, true);            // 压缩方式：0 = 存储（无压缩）
    lv.setUint16(10, 0, true);           // 修改时间
    lv.setUint16(12, 0, true);           // 修改日期
    lv.setUint32(14, crc, true);         // CRC32
    lv.setUint32(18, size, true);        // 压缩后大小
    lv.setUint32(22, size, true);        // 原始大小
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // 扩展字段长度
    local.set(nameBytes, 30);

    chunks.push(local, file.data);

    // —— Central Directory Header（中央目录头，46 字节 + 文件名） ——
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);   // 签名
    cv.setUint16(4, 20, true);           // 生成版本
    cv.setUint16(6, 20, true);           // 所需版本
    cv.setUint16(8, 0x0800, true);       // 通用标志
    cv.setUint16(10, 0, true);           // 压缩方式
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);           // 起始磁盘号
    cv.setUint16(36, 0, true);           // 内部属性
    cv.setUint32(38, 0, true);           // 外部属性
    cv.setUint32(42, offset, true);      // 本地文件头偏移
    cd.set(nameBytes, 46);

    central.push(cd);
    offset += local.length + size;
  });

  // —— End of Central Directory Record（结束记录，22 字节） ——
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  // 拼接三部分
  const result = new Uint8Array(offset + centralSize + end.length);
  let pos = 0;
  chunks.forEach((c) => { result.set(c, pos); pos += c.length; });
  central.forEach((c) => { result.set(c, pos); pos += c.length; });
  result.set(end, pos);
  return result;
}

// CRC32 校验（ZIP 规范使用）
function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function updateProgress(done, fail, total) {
  const finished = done + fail;
  progressFill.style.width = `${(finished / total) * 100}%`;
  progressText.textContent = `${finished} / ${total}`;
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}
