// 导航功能模块

import { elements } from './constants.js';

/**
 * 停止用量自动刷新（直接操作 DOM，避免循环依赖）
 */
function stopUsageAutoRefresh() {
    const autoRefreshToggle = document.getElementById('autoRefreshUsage');
    if (autoRefreshToggle && autoRefreshToggle.checked) {
        autoRefreshToggle.checked = false;
        // 触发 change 事件让 usage-manager 处理停止逻辑
        autoRefreshToggle.dispatchEvent(new Event('change'));
    }
}

/**
 * 初始化导航功能
 */
function initNavigation() {
    if (!elements.navItems || !elements.sections) {
        console.warn('导航元素未找到');
        return;
    }

    elements.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = item.dataset.section;

            // 离开用量查询页面时，关闭自动刷新
            if (sectionId !== 'usage') {
                stopUsageAutoRefresh();
            }

            // 更新 URL hash（不触发滚动）
            history.replaceState(null, '', '#' + sectionId);

            // 更新导航状态
            elements.navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // 显示对应章节
            elements.sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === sectionId) {
                    section.classList.add('active');
                }
            });
        });
    });

    // 根据 URL hash 恢复页面状态，默认显示 dashboard
    const hash = window.location.hash.slice(1);
    const validSections = Array.from(elements.sections).map(s => s.id);
    const targetSection = validSections.includes(hash) ? hash : 'dashboard';
    switchToSection(targetSection);

    // 监听 hash 变化
    window.addEventListener('hashchange', () => {
        const newHash = window.location.hash.slice(1);
        if (validSections.includes(newHash)) {
            switchToSection(newHash);
        }
    });
}

/**
 * 切换到指定章节
 * @param {string} sectionId - 章节ID
 */
function switchToSection(sectionId) {
    // 离开用量查询页面时，关闭自动刷新
    if (sectionId !== 'usage') {
        stopUsageAutoRefresh();
    }

    // 更新导航状态
    elements.navItems.forEach(nav => {
        nav.classList.remove('active');
        if (nav.dataset.section === sectionId) {
            nav.classList.add('active');
        }
    });

    // 显示对应章节
    elements.sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === sectionId) {
            section.classList.add('active');
        }
    });
}

/**
 * 切换到仪表盘页面
 */
function switchToDashboard() {
    switchToSection('dashboard');
}

/**
 * 切换到提供商页面
 */
function switchToProviders() {
    switchToSection('providers');
}

export {
    initNavigation,
    switchToSection,
    switchToDashboard,
    switchToProviders
};
