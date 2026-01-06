/**
 * Web Search Module
 * 提供服务端 Web 搜索功能，支持 DuckDuckGo 和 Bing
 */

import axios from 'axios';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('kiro:search');

/**
 * Web 搜索配置
 */
const WEB_SEARCH_CONFIG = {
    // 搜索引擎选择：'duckduckgo' | 'bing' | 'google'
    engine: process.env.WEB_SEARCH_ENGINE || 'duckduckgo',
    // Bing Search API Key (可选)
    bingApiKey: process.env.BING_API_KEY || '',
    // 最大结果数
    maxResults: parseInt(process.env.WEB_SEARCH_MAX_RESULTS) || 5,
    // 超时时间 (ms)
    timeout: 10000
};

/**
 * 服务端 Web Search 函数
 * @param {string} query - 搜索查询
 * @param {boolean} verboseLogging - 是否输出详细日志
 * @returns {Promise<{success: boolean, results: Array, source?: string, error?: string}>}
 */
export async function executeWebSearch(query, verboseLogging = false) {
    if (verboseLogging) {
        logger.info(`[Kiro WebSearch] Executing search: "${query}"`);
    }

    try {
        // 优先使用 Bing API (如果配置了 API Key)
        if (WEB_SEARCH_CONFIG.bingApiKey) {
            return await bingSearch(query, verboseLogging);
        }

        // 否则使用 DuckDuckGo (免费，无需 API Key)
        return await duckDuckGoSearch(query, verboseLogging);
    } catch (error) {
        logger.error('[Kiro WebSearch] Error:', { error: error.message });
        return {
            success: false,
            results: [],
            error: error.message
        };
    }
}

/**
 * DuckDuckGo 搜索 (免费，无需 API Key)
 * 使用 DuckDuckGo HTML 搜索页面抓取结果
 * @param {string} query - 搜索查询
 * @param {boolean} verboseLogging - 是否输出详细日志
 * @returns {Promise<{success: boolean, results: Array, source: string}>}
 */
export async function duckDuckGoSearch(query, verboseLogging = false) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await axios.get(url, {
        timeout: WEB_SEARCH_CONFIG.timeout,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    const html = response.data;
    const results = [];

    // 简单的 HTML 解析提取搜索结果
    // DuckDuckGo HTML 格式: <a class="result__a" href="...">Title</a>
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < WEB_SEARCH_CONFIG.maxResults) {
        const url = match[1];
        const title = match[2].replace(/<[^>]*>/g, '').trim();
        const snippet = match[3].replace(/<[^>]*>/g, '').trim();

        if (url && title && !url.startsWith('/')) {
            results.push({ title, url, snippet });
        }
    }

    // 如果正则没匹配到，尝试另一种模式
    if (results.length === 0) {
        const altRegex = /<a[^>]*class="[^"]*result[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
        while ((match = altRegex.exec(html)) !== null && results.length < WEB_SEARCH_CONFIG.maxResults) {
            const url = match[1];
            const title = match[2].trim();
            if (url && title && url.startsWith('http')) {
                results.push({ title, url, snippet: '' });
            }
        }
    }

    if (verboseLogging) {
        logger.info(`[Kiro WebSearch] DuckDuckGo found ${results.length} results`);
    }

    return {
        success: true,
        results,
        source: 'DuckDuckGo'
    };
}

/**
 * Bing Search API (需要 API Key)
 * @param {string} query - 搜索查询
 * @param {boolean} verboseLogging - 是否输出详细日志
 * @returns {Promise<{success: boolean, results: Array, source: string}>}
 */
export async function bingSearch(query, verboseLogging = false) {
    const url = 'https://api.bing.microsoft.com/v7.0/search';

    const response = await axios.get(url, {
        timeout: WEB_SEARCH_CONFIG.timeout,
        params: {
            q: query,
            count: WEB_SEARCH_CONFIG.maxResults,
            responseFilter: 'Webpages'
        },
        headers: {
            'Ocp-Apim-Subscription-Key': WEB_SEARCH_CONFIG.bingApiKey
        }
    });

    const results = (response.data.webPages?.value || []).map(item => ({
        title: item.name,
        url: item.url,
        snippet: item.snippet
    }));

    if (verboseLogging) {
        logger.info(`[Kiro WebSearch] Bing found ${results.length} results`);
    }

    return {
        success: true,
        results,
        source: 'Bing'
    };
}

/**
 * 将搜索结果格式化为可读文本
 * @param {{success: boolean, results: Array, source?: string, error?: string}} searchResult - 搜索结果
 * @returns {string} 格式化后的文本
 */
export function formatSearchResults(searchResult) {
    if (!searchResult.success) {
        return `Search failed: ${searchResult.error || 'Unknown error'}`;
    }

    if (searchResult.results.length === 0) {
        return 'No results found.';
    }

    let text = `Found ${searchResult.results.length} results (via ${searchResult.source}):\n\n`;

    searchResult.results.forEach((result, index) => {
        text += `${index + 1}. **${result.title}**\n`;
        text += `   URL: ${result.url}\n`;
        if (result.snippet) {
            text += `   ${result.snippet}\n`;
        }
        text += '\n';
    });

    return text;
}
