// main.js — 官网交互脚本
// 功能：移动端汉堡菜单、导航栏滚动阴影、当前区块高亮、滚动进入视口淡入动画
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initMenu();
  initNavbarScroll();
  initNavHighlight();
  initReveal();
});

/* ------------------------------------------------------------
   1) 移动端汉堡菜单开关
   ------------------------------------------------------------ */
function initMenu() {
  const toggle = document.getElementById('menuToggle');
  const links = document.getElementById('navLinks');

  toggle.addEventListener('click', () => {
    const isOpen = links.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  // 点击导航链接后自动收起菜单
  links.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

/* ------------------------------------------------------------
   2) 导航栏滚动阴影
   ------------------------------------------------------------ */
function initNavbarScroll() {
  const navbar = document.getElementById('navbar');
  const onScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 8);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ------------------------------------------------------------
   3) 导航当前区块高亮（滚动监听）
   ------------------------------------------------------------ */
function initNavHighlight() {
  const links = Array.from(document.querySelectorAll('.nav-link'));
  // 区块 id 与导航链接的对应关系
  const sections = links
    .map((link) => {
      const id = link.getAttribute('href').slice(1);
      return document.getElementById(id);
    })
    .filter(Boolean);

  const onScroll = () => {
    // 以页面中部偏上作为“当前区块”判定基准
    const pos = window.scrollY + window.innerHeight * 0.35;
    let currentId = sections[0] ? sections[0].id : null;

    sections.forEach((section) => {
      if (section.offsetTop <= pos) {
        currentId = section.id;
      }
    });

    // 滚动到页面底部时，高亮最后一个区块
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
      currentId = sections[sections.length - 1].id;
    }

    links.forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === '#' + currentId);
    });
  };

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ------------------------------------------------------------
   4) 滚动进入视口时的淡入上移动画（IntersectionObserver）
   ------------------------------------------------------------ */
function initReveal() {
  // 需要动画的元素：卡片、步骤等
  const targets = document.querySelectorAll(
    '.intro-card, .feature-card, .step, .hero-text, .hero-visual'
  );

  // 初始标记为待显示
  targets.forEach((el) => el.classList.add('reveal'));

  // 不支持 IntersectionObserver 的旧浏览器直接全部显示
  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target); // 只触发一次
        }
      });
    },
    { threshold: 0.12 }
  );

  targets.forEach((el) => observer.observe(el));
}
