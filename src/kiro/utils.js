import crypto from 'crypto';
import * as os from 'os';

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

export function repairJson(jsonStr) {
    let repaired = jsonStr;
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');
    repaired = repaired.replace(/:\s*([a-zA-Z0-9_]+)(?=[,\}\]])/g, ':"$1"');
    return repaired;
}

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

export async function getMacAddressSha256() {
    const randomMac = Array.from({ length: 6 }, () =>
        Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join(':');

    return crypto.createHash('sha256').update(randomMac).digest('hex');
}

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
