/**
 * 转换器工厂模块
 *
 * 使用工厂模式管理转换器实例的创建和缓存。
 *
 * @module converters/ConverterFactory
 */
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ module: 'ConverterFactory' });

export class ConverterFactory {
    // 私有静态属性：存储转换器实例
    static #converters = new Map();
    
    // 私有静态属性：存储转换器类
    static #converterClasses = new Map();

    /**
     * 注册转换器类
     *
     * @param {string} protocolPrefix - 协议前缀
     * @param {Class} ConverterClass - 转换器类
     */
    static registerConverter(protocolPrefix, ConverterClass) {
        this.#converterClasses.set(protocolPrefix, ConverterClass);
    }

    /**
     * 获取转换器实例（带缓存）
     *
     * @param {string} protocolPrefix - 协议前缀
     * @returns {BaseConverter} 转换器实例
     */
    static getConverter(protocolPrefix) {
        // 检查缓存
        if (this.#converters.has(protocolPrefix)) {
            return this.#converters.get(protocolPrefix);
        }

        // 创建新实例
        const converter = this.createConverter(protocolPrefix);
        
        // 缓存实例
        if (converter) {
            this.#converters.set(protocolPrefix, converter);
        }

        return converter;
    }

    /**
     * 创建转换器实例
     *
     * @param {string} protocolPrefix - 协议前缀
     * @returns {BaseConverter} 转换器实例
     */
    static createConverter(protocolPrefix) {
        const ConverterClass = this.#converterClasses.get(protocolPrefix);
        
        if (!ConverterClass) {
            throw new Error(`No converter registered for protocol: ${protocolPrefix}`);
        }

        return new ConverterClass();
    }

    /**
     * 清除所有缓存的转换器
     *
     * @returns {void}
     */
    static clearCache() {
        this.#converters.clear();
    }

    /**
     * 清除特定协议的转换器缓存
     *
     * @param {string} protocolPrefix - 协议前缀
     * @returns {void}
     */
    static clearConverterCache(protocolPrefix) {
        this.#converters.delete(protocolPrefix);
    }

    /**
     * 获取所有已注册的协议
     *
     * @returns {Array<string>} 协议前缀数组
     */
    static getRegisteredProtocols() {
        return Array.from(this.#converterClasses.keys());
    }

    /**
     * 检查协议是否已注册
     *
     * @param {string} protocolPrefix - 协议前缀
     * @returns {boolean} 是否已注册
     */
    static isProtocolRegistered(protocolPrefix) {
        return this.#converterClasses.has(protocolPrefix);
    }
}

export default ConverterFactory;
