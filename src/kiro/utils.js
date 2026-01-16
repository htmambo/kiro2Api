/**
 * Kiro 通用工具函数
 *
 * 提供 HTML 反转义、Schema 判断、图片格式检测、JSON 修复、
 * 随机 User-Agent 组件与设备指纹等能力。
 *
 * @module kiro/utils
 */
import crypto from 'crypto';
import * as os from 'os';

/**
 * HTML 实体反转义
 *
 * @param {string} str - 原始字符串
 * @returns {string} 反转义后的字符串
 */
export function unescapeHTML(str) {
    if (!str || typeof str !== 'string') return str;

    const escapeMap = {
        '&amp;': '&',
        '&#38;': '&',
        '&lt;': '<',
        '&#60;': '<',
        '&gt;': '>',
        '&#62;': '>',
        '&apos;': "'",
        '&#39;': "'",
        '&quot;': '"',
        '&#34;': '"',
        '&#x27;': "'",
        '&#x60;': '`',
        '&#x2F;': '/',
        '&#x5C;': '\\'
    };

    return str.replace(/&(?:amp|#38|#x26|lt|#60|#x3C|gt|#62|#x3E|apos|#39|#x27|quot|#34|#x22|#x60|#x2F|#x5C);/gi, match => escapeMap[match.toLowerCase()] || match);
}

/**
 * 判断是否为 Zod Schema
 *
 * @param {*} schema - 待判断对象
 * @returns {boolean} 是否为 Zod Schema
 */
export function isZodSchema(schema) {
    if (typeof schema !== "object" || schema === null) {
        return false;
    }

    if ("_def" in schema && !("_zod" in schema)) {
        const def = schema._def;
        return typeof def === "object" && def != null && "typeName" in def;
    }

    if ("_zod" in schema) {
        const zod = schema._zod;
        return typeof zod === "object" && zod !== null && "def" in zod;
    }

    return false;
}

/**
 * 从图片 Base64 或 URL 头部推断格式
 *
 * @param {string} imageUrl - 图片数据或 URL
 * @returns {'jpeg'|'png'|'gif'|'webp'} 图片格式
 */
export function detectImageFormat(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') {
        return 'jpeg';
    }

    const base64Header = imageUrl.split(',')[0];

    if (base64Header.includes('png')) {
        return 'png';
    } else if (base64Header.includes('gif')) {
        return 'gif';
    } else if (base64Header.includes('webp')) {
        return 'webp';
    } else {
        return 'jpeg';
    }
}

/**
 * 查找匹配的括号位置
 *
 * @param {string} text - 原始文本
 * @param {number} startPos - 起始位置
 * @param {string} [openChar='['] - 开始符号
 * @param {string} [closeChar=']'] - 结束符号
 * @returns {number} 匹配位置，未找到返回 -1
 */
export function findMatchingBracket(text, startPos, openChar = '[', closeChar = ']') {
    let bracketCount = 0;
    for (let i = startPos; i < text.length; i++) {
        const char = text[i];
        if (char === openChar) {
            bracketCount++;
        } else if (char === closeChar) {
            bracketCount--;
            if (bracketCount === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * 修复可能不完整的 JSON 字符串
 *
 * @param {string} jsonStr - 原始 JSON 字符串
 * @returns {string} 修复后的 JSON 字符串
 */
export function repairJson(jsonStr) {
    let repaired = jsonStr;
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');
    repaired = repaired.replace(/:\s*([a-zA-Z0-9_]+)(?=[,\}\]])/g, ':"$1"');
    return repaired;
}

/**
 * 生成随机化 User-Agent 组件
 *
 * @returns {Object} 随机组件集合
 */
export function generateRandomUserAgentComponents() {
    const winVersions = ['10.0.19041', '10.0.19042', '10.0.19043', '10.0.19044', '10.0.19045', '10.0.22000', '10.0.22621', '10.0.22631', '10.0.26100'];
    const nodeVersions = ['18.17.0', '18.18.0', '18.19.0', '20.10.0', '20.11.0', '20.12.0', '22.0.0', '22.1.0', '22.2.0', '22.11.0', '22.12.0', '22.21.1'];
    const sdkVersions = ['1.0.24', '1.0.25', '1.0.26', '1.0.27', '1.0.28'];
    const kiroVersions = ['0.7.40', '0.7.41', '0.7.42', '0.7.43', '0.7.44', '0.7.45', '0.7.46'];
    const osTypes = ['win32', 'darwin', 'linux'];

    return {
        winVersion: winVersions[Math.floor(Math.random() * winVersions.length)],
        nodeVersion: nodeVersions[Math.floor(Math.random() * nodeVersions.length)],
        sdkVersion: sdkVersions[Math.floor(Math.random() * sdkVersions.length)],
        kiroVersion: kiroVersions[Math.floor(Math.random() * kiroVersions.length)],
        osType: osTypes[Math.floor(Math.random() * osTypes.length)]
    };
}

/**
 * 生成随机 MAC 地址的 SHA-256
 *
 * @returns {Promise<string>} 哈希值
 */
export async function getMacAddressSha256() {
    const randomMac = Array.from({ length: 6 }, () =>
        Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join(':');

    return crypto.createHash('sha256').update(randomMac).digest('hex');
}

/**
 * 获取本机 MAC 地址（或随机值）并计算 SHA-256
 *
 * @returns {Promise<string>} 哈希值
 */
export async function getOriginalMacAddressSha256() {
    const networkInterfaces = os.networkInterfaces();
    let macAddress = '';

    for (const interfaceName in networkInterfaces) {
        const iface = networkInterfaces[interfaceName];
        if (!iface) continue;
        for (const alias of iface) {
            if (alias && alias.mac && alias.mac !== '00:00:00:00:00:00') {
                macAddress = alias.mac;
                break;
            }
        }
        if (macAddress) break;
    }

    if (!macAddress) {
        macAddress = Array.from({ length: 6 }, () =>
            Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
        ).join(':');
    }

    return crypto.createHash('sha256').update(macAddress).digest('hex');
}
