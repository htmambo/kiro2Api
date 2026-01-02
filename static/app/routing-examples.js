// 路径路由示例功能模块

import { showToast } from './utils.js';
import { t } from './i18n.js';

/**
 * 初始化路径路由示例功能
 */
function initRoutingExamples() {
    // 延迟初始化，确保所有DOM都加载完成
    setTimeout(() => {
        initProtocolTabs();
        initCopyButtons();
        initCardInteractions();
    }, 100);
}

/**
 * 初始化协议标签切换功能
 */
function initProtocolTabs() {
    // 使用事件委托方式绑定点击事件
    document.addEventListener('click', function(e) {
        // 检查点击的是不是协议标签或者其子元素
        const tab = e.target.classList.contains('protocol-tab') ? e.target : e.target.closest('.protocol-tab');
        
        if (tab) {
            e.preventDefault();
            e.stopPropagation();
            
            const targetProtocol = tab.dataset.protocol;
            const card = tab.closest('.routing-example-card');
            
            if (!card) {
                return;
            }
            
            // 移除当前卡片中所有标签和内容的活动状态
            const cardTabs = card.querySelectorAll('.protocol-tab');
            const cardContents = card.querySelectorAll('.protocol-content');
            
            cardTabs.forEach(t => t.classList.remove('active'));
            cardContents.forEach(c => c.classList.remove('active'));
            
            // 为当前标签和对应内容添加活动状态
            tab.classList.add('active');
            
            // 使用更精确的选择器来查找对应的内容
            const targetContent = card.querySelector(`.protocol-content[data-protocol="${targetProtocol}"]`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        }
    });
}

/**
 * 初始化复制按钮功能
 */
function initCopyButtons() {
    document.addEventListener('click', async function(e) {
        if (e.target.closest('.copy-btn')) {
            e.stopPropagation();
            
            const button = e.target.closest('.copy-btn');
            const path = button.dataset.path;
            if (!path) return;
            
            try {
                await navigator.clipboard.writeText(path);
                showToast(t('common.success'), `${t('common.success')}: ${path}`, 'success');
                
                // 临时更改按钮图标
                const icon = button.querySelector('i');
                if (icon) {
                    const originalClass = icon.className;
                    icon.className = 'fas fa-check';
                    button.style.color = 'var(--success-color)';
                    
                    setTimeout(() => {
                        icon.className = originalClass;
                        button.style.color = '';
                    }, 2000);
                }
                
            } catch (error) {
                console.error('Failed to copy to clipboard:', error);
                showToast(t('common.error'), t('common.error'), 'error');
            }
        }
    });
}

/**
 * 初始化卡片交互功能
 */
function initCardInteractions() {
    const routingCards = document.querySelectorAll('.routing-example-card');
    
    routingCards.forEach(card => {
        // 添加悬停效果
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-4px)';
            card.style.boxShadow = 'var(--shadow-lg)';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
            card.style.boxShadow = '';
        });
        
    });
}

/**
 * 获取所有可用的路由端点
 * @returns {Array} 路由端点数组
 */
function getAvailableRoutes() {
    return [
        {
            provider: 'claude-kiro-oauth',
            name: 'Claude Kiro OAuth',
            paths: {
                claude: '/claude-kiro-oauth/v1/messages'
            },
            description: t('dashboard.routing.free'),
            badge: t('dashboard.routing.free'),
            badgeClass: 'oauth'
        }
    ];
}

/**
 * 高亮显示特定提供商路由
 * @param {string} provider - 提供商标识
 */
function highlightProviderRoute(provider) {
    const card = document.querySelector(`[data-provider="${provider}"]`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.borderColor = 'var(--success-color)';
        card.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.1)';
        
        setTimeout(() => {
            card.style.borderColor = '';
            card.style.boxShadow = '';
        }, 3000);
        
        showToast(t('common.success'), t('common.success') + `: ${provider}`, 'success');
    }
}

export {
    initRoutingExamples,
    getAvailableRoutes,
    highlightProviderRoute
};
