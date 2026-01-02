// 用量管理模块

import { showToast } from './utils.js';
import { getAuthHeaders } from './auth.js';
import { t, getCurrentLanguage } from './i18n.js';

// 自动刷新定时器
let autoRefreshTimer = null;

/**
 * 初始化用量管理功能
 */
export function initUsageManager() {
    const refreshBtn = document.getElementById('refreshUsageBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshUsage);
    }

    // 初始化自动刷新开关
    const autoRefreshToggle = document.getElementById('autoRefreshUsage');
    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
    }

    // 初始化时自动加载缓存数据
    loadUsage();
}

/**
 * 启动自动刷新
 */
function startAutoRefresh() {
    stopAutoRefresh(); // 先清除已有的定时器
    refreshUsage();
    autoRefreshTimer = setInterval(() => {
        refreshUsage();
    }, 10000); // 每10秒刷新一次
}

/**
 * 停止自动刷新
 */
export function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

/**
 * 加载用量数据（优先从缓存读取）
 */
export async function loadUsage() {
    const errorEl = document.getElementById('usageError');
    const contentEl = document.getElementById('usageContent');
    const emptyEl = document.getElementById('usageEmpty');
    const lastUpdateEl = document.getElementById('usageLastUpdate');
    const refreshBtn = document.getElementById('refreshUsageBtn');
    const btnIcon = refreshBtn?.querySelector('i');

    // 显示加载状态 - 修改按钮图标为动态旋转，添加高亮样式
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('auto-refreshing');
    }
    if (btnIcon) {
        btnIcon.className = 'fas fa-spinner fa-spin';
    }

    try {
        // 不带 refresh 参数，优先读取缓存
        const response = await fetch('/api/usage', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // 渲染用量数据
        renderUsageData(data, contentEl);

        // 更新最后更新时间
        if (lastUpdateEl) {
            const timeStr = new Date(data.timestamp || Date.now()).toLocaleString(getCurrentLanguage());
            if (data.fromCache && data.timestamp) {
                lastUpdateEl.textContent = t('usage.lastUpdateCache', { time: timeStr });
                lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdateCache');
                lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
            } else {
                lastUpdateEl.textContent = t('usage.lastUpdate', { time: timeStr });
                lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdate');
                lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
            }
        }
    } catch (error) {
        console.error('获取用量数据失败:', error);

        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsgEl = document.getElementById('usageErrorMessage');
            if (errorMsgEl) {
                errorMsgEl.textContent = error.message || t('usage.title') + '失败';
            }
        }
    } finally {
        // 恢复按钮图标和状态
        if (btnIcon) {
            btnIcon.className = 'fas fa-sync-alt';
        }
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('auto-refreshing');
        }
    }
}

/**
 * 刷新用量数据（强制从服务器获取最新数据）
 */
export async function refreshUsage() {
    const errorEl = document.getElementById('usageError');
    const contentEl = document.getElementById('usageContent');
    const emptyEl = document.getElementById('usageEmpty');
    const lastUpdateEl = document.getElementById('usageLastUpdate');
    const refreshBtn = document.getElementById('refreshUsageBtn');
    const btnIcon = refreshBtn?.querySelector('i');
    const autoRefreshToggle = document.getElementById('autoRefreshUsage');
    const isAutoRefresh = autoRefreshToggle?.checked;

    // 显示加载状态 - 修改按钮图标为动态旋转，添加高亮样式
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('auto-refreshing');
    }
    if (btnIcon) {
        btnIcon.className = 'fas fa-spinner fa-spin';
    }

    try {
        // 带 refresh=true 参数，强制刷新
        const response = await fetch('/api/usage?refresh=true', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // 渲染用量数据
        renderUsageData(data, contentEl);

        // 更新最后更新时间
        if (lastUpdateEl) {
            const timeStr = new Date().toLocaleString(getCurrentLanguage());
            lastUpdateEl.textContent = t('usage.lastUpdate', { time: timeStr });
            lastUpdateEl.setAttribute('data-i18n', 'usage.lastUpdate');
            lastUpdateEl.setAttribute('data-i18n-params', JSON.stringify({ time: timeStr }));
        }

        // 自动刷新时不显示 toast
        if (!isAutoRefresh) {
            showToast(t('common.success'), t('common.refresh.success'), 'success');
        }
    } catch (error) {
        console.error('获取用量数据失败:', error);

        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsgEl = document.getElementById('usageErrorMessage');
            if (errorMsgEl) {
                errorMsgEl.textContent = error.message || t('usage.title') + '失败';
            }
        }

        showToast(t('common.error'), t('common.refresh.failed') + ': ' + error.message, 'error');
    } finally {
        // 恢复按钮图标和状态
        if (btnIcon) {
            btnIcon.className = 'fas fa-sync-alt';
        }
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('auto-refreshing');
        }
    }
}

/**
 * 渲染用量数据
 * @param {Object} data - 用量数据
 * @param {HTMLElement} container - 容器元素
 */
function renderUsageData(data, container) {
    if (!container) return;

    // 清空容器
    container.innerHTML = '';

    if (!data || !data.providers || Object.keys(data.providers).length === 0) {
        container.innerHTML = `
            <div class="usage-empty">
                <i class="fas fa-chart-bar"></i>
                <p data-i18n="usage.noData">${t('usage.noData')}</p>
            </div>
        `;
        return;
    }

    // 按提供商分组收集已初始化且未禁用的实例
    const groupedInstances = {};
    
    for (const [providerType, providerData] of Object.entries(data.providers)) {
        if (providerData.instances && providerData.instances.length > 0) {
            const validInstances = [];
            for (const instance of providerData.instances) {
                // 过滤掉服务实例未初始化的
                if (instance.error === '服务实例未初始化') {
                    continue;
                }
                // 过滤掉已禁用的提供商
                if (instance.isDisabled) {
                    continue;
                }
                validInstances.push(instance);
            }
            if (validInstances.length > 0) {
                groupedInstances[providerType] = validInstances;
            }
        }
    }

    if (Object.keys(groupedInstances).length === 0) {
        container.innerHTML = `
            <div class="usage-empty">
                <i class="fas fa-chart-bar"></i>
                <p data-i18n="usage.noInstances">${t('usage.noInstances')}</p>
            </div>
        `;
        return;
    }

    // 按提供商分组渲染
    for (const [providerType, instances] of Object.entries(groupedInstances)) {
        const groupContainer = createProviderGroup(providerType, instances);
        container.appendChild(groupContainer);
    }
}

/**
 * 创建提供商分组容器
 * @param {string} providerType - 提供商类型
 * @param {Array} instances - 实例数组
 * @returns {HTMLElement} 分组容器元素
 */
function createProviderGroup(providerType, instances) {
    const groupContainer = document.createElement('div');
    groupContainer.className = 'usage-provider-group';
    
    const providerDisplayName = getProviderDisplayName(providerType);
    const providerIcon = getProviderIcon(providerType);
    const instanceCount = instances.length;
    const successCount = instances.filter(i => i.success).length;
    
    // 分组头部（可点击折叠）
    const header = document.createElement('div');
    header.className = 'usage-group-header';
    header.innerHTML = `
        <div class="usage-group-title">
            <i class="fas fa-chevron-right toggle-icon"></i>
            <i class="${providerIcon} provider-icon"></i>
            <span class="provider-name">${providerDisplayName}</span>
            <span class="instance-count" data-i18n="usage.group.instances" data-i18n-params='{"count":"${instanceCount}"}'>${t('usage.group.instances', { count: instanceCount })}</span>
            <span class="success-count ${successCount === instanceCount ? 'all-success' : ''}" data-i18n="usage.group.success" data-i18n-params='{"count":"${successCount}","total":"${instanceCount}"}'>${t('usage.group.success', { count: successCount, total: instanceCount })}</span>
        </div>
    `;
    // 初始化统计数据
    const summary = {
        usedQuota: 0,
        totalQuota: 0,
        percentUsed: 0,
        remainingQuota: 0,
        totalCount: instances.length,
        healthyCount: 0,
        bannedCount: 0
    };

    // 点击头部切换折叠状态
    header.addEventListener('click', () => {
        groupContainer.classList.toggle('collapsed');
    });

    // 分组内容（卡片网格）
    const content = document.createElement('div');
    content.className = 'usage-group-content';

    const gridContainer = document.createElement('div');
    gridContainer.className = 'usage-cards-grid';

    // 遍历实例，计算统计数据
    for (const instance of instances) {
        // 计算用量统计
        if (instance.usage && instance.usage.usageBreakdown) {
            const totalUsage = calculateTotalUsage(instance.usage.usageBreakdown);
            summary.usedQuota += totalUsage.used;
            summary.totalQuota += totalUsage.limit;
        }

        // 计算健康状态统计
        if (instance.isHealthy) {
            summary.healthyCount++;
        } else if (instance.error || !instance.success) {
            summary.bannedCount++;
        }

        const instanceCard = createInstanceUsageCard(instance, providerType);
        gridContainer.appendChild(instanceCard);
    }

    // 计算百分比和剩余额度
    summary.percentUsed = summary.totalQuota > 0 ? (summary.usedQuota / summary.totalQuota) * 100 : 0;
    summary.remainingQuota = summary.totalQuota - summary.usedQuota;

    groupContainer.appendChild(header);

    // 创建汇总信息区域
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'usage-group-summary';

    // 确定用量颜色类
    const usageColorClass = summary.percentUsed > 80 ? 'text-danger' : summary.percentUsed > 50 ? 'text-warning' : 'text-success';
    const progressColorClass = summary.percentUsed > 80 ? 'danger' : summary.percentUsed > 50 ? 'warning' : 'normal';

    summaryDiv.innerHTML = `
        <div class="summary-content">
            <div class="summary-usage">
                <div class="summary-usage-header">
                    <span class="summary-label">已使用 / 总额度</span>
                    <span class="summary-values">
                        <span class="${usageColorClass}">${summary.usedQuota.toFixed(1)}</span>
                        <span class="text-muted"> / </span>
                        <span>${summary.totalQuota.toFixed(1)}</span>
                    </span>
                </div>
                <div class="progress-bar ${progressColorClass}">
                    <div class="progress-fill" style="width: ${Math.min(100, summary.percentUsed).toFixed(2)}%"></div>
                </div>
                <div class="summary-usage-footer">
                    <span>${summary.percentUsed.toFixed(1)}% 已使用</span>
                    <span>剩余 ${summary.remainingQuota.toFixed(1)}</span>
                </div>
            </div>

            <div class="summary-stats">
                <div class="summary-stats-grid">
                    <div class="stat-item">
                        <div class="stat-value">${summary.totalCount}</div>
                        <div class="stat-label">全部</div>
                    </div>
                    <div class="stat-item stat-healthy">
                        <div class="stat-value">${summary.healthyCount}</div>
                        <div class="stat-label">健康</div>
                    </div>
                    <div class="stat-item stat-error">
                        <div class="stat-value">${summary.bannedCount}</div>
                        <div class="stat-label">异常</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    groupContainer.appendChild(summaryDiv);
    
    content.appendChild(gridContainer);
    groupContainer.appendChild(content);
    
    return groupContainer;
}

/**
 * 创建实例用量卡片
 * @param {Object} instance - 实例数据
 * @param {string} providerType - 提供商类型
 * @returns {HTMLElement} 卡片元素
 */
function createInstanceUsageCard(instance, providerType) {
    const card = document.createElement('div');
    card.className = `usage-instance-card ${instance.success ? 'success' : 'error'}`;

    const providerDisplayName = getProviderDisplayName(providerType);
    const providerIcon = getProviderIcon(providerType);

    // 实例头部 - 整合用户信息
    const header = document.createElement('div');
    header.className = 'usage-instance-header';
    
    const statusIcon = instance.success
        ? '<i class="fas fa-check-circle status-success"></i>'
        : '<i class="fas fa-times-circle status-error"></i>';
    
    const healthBadge = instance.isDisabled
        ? `<span class="badge badge-disabled" data-i18n="usage.card.status.disabled">${t('usage.card.status.disabled')}</span>`
        : (instance.isHealthy
            ? `<span class="badge badge-healthy" data-i18n="usage.card.status.healthy">${t('usage.card.status.healthy')}</span>`
            : `<span class="badge badge-unhealthy" data-i18n="usage.card.status.unhealthy">${t('usage.card.status.unhealthy')}</span>`);

    // 获取用户邮箱和订阅信息
    const userEmail = instance.usage?.user?.email || '';
    const subscriptionTitle = instance.usage?.subscription?.title || '';
    
    // 用户信息行
    const userInfoHTML = userEmail ? `
        <div class="instance-user-info">
            <span class="user-email" title="${userEmail}"><i class="fas fa-envelope"></i> ${userEmail}</span>
            ${subscriptionTitle ? `<span class="user-subscription">${subscriptionTitle}</span>` : ''}
        </div>
    ` : '';

    header.innerHTML = `
        <div class="instance-header-top">
            <div class="instance-provider-type">
                <i class="${providerIcon}"></i>
                <span>${providerDisplayName}</span>
            </div>
            <div class="instance-status-badges">
                ${statusIcon}
                ${healthBadge}
            </div>
        </div>
        <div class="instance-name">
            <span class="instance-name-text" title="${instance.name || instance.uuid}">${instance.name || instance.uuid}</span>
        </div>
        ${userInfoHTML}
    `;
    card.appendChild(header);

    // 实例内容 - 只显示用量和到期时间
    const content = document.createElement('div');
    content.className = 'usage-instance-content';

    if (instance.error) {
        content.innerHTML = `
            <div class="usage-error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${instance.error}</span>
            </div>
        `;
    } else if (instance.usage) {
        content.appendChild(renderUsageDetails(instance.usage));
    }

    card.appendChild(content);
    return card;
}

/**
 * 渲染用量详情 - 显示总用量、用量明细和到期时间
 * @param {Object} usage - 用量数据
 * @returns {HTMLElement} 详情元素
 */
function renderUsageDetails(usage) {
    const container = document.createElement('div');
    container.className = 'usage-details';

    // 计算总用量
    const totalUsage = calculateTotalUsage(usage.usageBreakdown);
    
    // 总用量进度条
    if (totalUsage.hasData) {
        const totalSection = document.createElement('div');
        totalSection.className = 'usage-section total-usage';
        
        const progressClass = totalUsage.percent >= 90 ? 'danger' : (totalUsage.percent >= 70 ? 'warning' : 'normal');
        
        totalSection.innerHTML = `
            <div class="total-usage-header">
                <span class="total-label"><i class="fas fa-chart-pie"></i> <span data-i18n="usage.card.totalUsage">${t('usage.card.totalUsage')}</span></span>
                <span class="total-value">${formatNumber(totalUsage.used)} / ${formatNumber(totalUsage.limit)}</span>
            </div>
            <div class="progress-bar ${progressClass}">
                <div class="progress-fill" style="width: ${totalUsage.percent}%"></div>
            </div>
            <div class="total-percent">${totalUsage.percent.toFixed(2)}%</div>
        `;
        container.appendChild(totalSection);
    }

    // 用量明细（包含免费试用和奖励信息）
    if (usage.usageBreakdown && usage.usageBreakdown.length > 0) {
        const breakdownSection = document.createElement('div');
        breakdownSection.className = 'usage-section usage-breakdown-compact';
        
        let breakdownHTML = '';
        
        for (const breakdown of usage.usageBreakdown) {
            breakdownHTML += createUsageBreakdownHTML(breakdown);
        }
        
        breakdownSection.innerHTML = breakdownHTML;
        container.appendChild(breakdownSection);
    }

    return container;
}

/**
 * 创建用量明细 HTML（紧凑版）
 * @param {Object} breakdown - 用量明细数据
 * @returns {string} HTML 字符串
 */
function createUsageBreakdownHTML(breakdown) {
    const usagePercent = breakdown.usageLimit > 0
        ? Math.min(100, (breakdown.currentUsage / breakdown.usageLimit) * 100)
        : 0;
    
    const progressClass = usagePercent >= 90 ? 'danger' : (usagePercent >= 70 ? 'warning' : 'normal');

    let html = `
        <div class="breakdown-item-compact">
            <div class="breakdown-header-compact">
                <span class="breakdown-name">${breakdown.displayName || breakdown.resourceType}</span>
                <span class="breakdown-usage">${formatNumber(breakdown.currentUsage)} / ${formatNumber(breakdown.usageLimit)}</span>
            </div>
            <div class="progress-bar-small ${progressClass}">
                <div class="progress-fill" style="width: ${usagePercent}%"></div>
            </div>
    `;

    // 免费试用信息
    if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
        html += `
            <div class="extra-usage-info free-trial">
                <span class="extra-label"><i class="fas fa-gift"></i> <span data-i18n="usage.card.freeTrial">${t('usage.card.freeTrial')}</span></span>
                <span class="extra-value">${formatNumber(breakdown.freeTrial.currentUsage)} / ${formatNumber(breakdown.freeTrial.usageLimit)}</span>
                <span class="extra-expires" data-i18n="usage.card.expires" data-i18n-params='{"time":"${formatDate(breakdown.freeTrial.expiresAt)}"}'>${t('usage.card.expires', { time: formatDate(breakdown.freeTrial.expiresAt) })}</span>
            </div>
        `;
    }

    // 奖励信息
    if (breakdown.bonuses && breakdown.bonuses.length > 0) {
        for (const bonus of breakdown.bonuses) {
            if (bonus.status === 'ACTIVE') {
                html += `
                    <div class="extra-usage-info bonus">
                        <span class="extra-label"><i class="fas fa-star"></i> ${bonus.displayName || bonus.code}</span>
                        <span class="extra-value">${formatNumber(bonus.currentUsage)} / ${formatNumber(bonus.usageLimit)}</span>
                        <span class="extra-expires" data-i18n="usage.card.expires" data-i18n-params='{"time":"${formatDate(bonus.expiresAt)}"}'>${t('usage.card.expires', { time: formatDate(bonus.expiresAt) })}</span>
                    </div>
                `;
            }
        }
    }

    html += '</div>';
    return html;
}

/**
 * 计算总用量（包含基础用量、免费试用和奖励）
 * @param {Array} usageBreakdown - 用量明细数组
 * @returns {Object} 总用量信息
 */
function calculateTotalUsage(usageBreakdown) {
    if (!usageBreakdown || usageBreakdown.length === 0) {
        return { hasData: false, used: 0, limit: 0, percent: 0 };
    }

    let totalUsed = 0;
    let totalLimit = 0;

    for (const breakdown of usageBreakdown) {
        // 基础用量
        totalUsed += breakdown.currentUsage || 0;
        totalLimit += breakdown.usageLimit || 0;
        
        // 免费试用用量
        if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
            totalUsed += breakdown.freeTrial.currentUsage || 0;
            totalLimit += breakdown.freeTrial.usageLimit || 0;
        }
        
        // 奖励用量
        if (breakdown.bonuses && breakdown.bonuses.length > 0) {
            for (const bonus of breakdown.bonuses) {
                if (bonus.status === 'ACTIVE') {
                    totalUsed += bonus.currentUsage || 0;
                    totalLimit += bonus.usageLimit || 0;
                }
            }
        }
    }

    const percent = totalLimit > 0 ? Math.min(100, (totalUsed / totalLimit) * 100) : 0;

    return {
        hasData: true,
        used: totalUsed,
        limit: totalLimit,
        percent: percent
    };
}

/**
 * 获取提供商显示名称
 * @param {string} providerType - 提供商类型
 * @returns {string} 显示名称
 */
function getProviderDisplayName(providerType) {
    const names = {
        'claude-kiro-oauth': 'Claude Kiro OAuth'
    };
    return names[providerType] || providerType;
}

/**
 * 获取提供商图标
 * @param {string} providerType - 提供商类型
 * @returns {string} 图标类名
 */
function getProviderIcon(providerType) {
    const icons = {
        'claude-kiro-oauth': 'fas fa-robot'
    };
    return icons[providerType] || 'fas fa-server';
}


/**
 * 格式化数字（向上取整保留两位小数）
 * @param {number} num - 数字
 * @returns {string} 格式化后的数字
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '0.00';
    // 向上取整到两位小数
    const rounded = Math.ceil(num * 100) / 100;
    return rounded.toFixed(2);
}

/**
 * 格式化日期
 * @param {string} dateStr - ISO 日期字符串
 * @returns {string} 格式化后的日期
 */
function formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
        const date = new Date(dateStr);
        return date.toLocaleString(getCurrentLanguage(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}
