/**
 * Account Storage Module - 账号存储模块
 *
 * 该模块提供账号存储层的统一入口，包括：
 * - AccountStore 接口定义
 * - JSONAccountStore 和 SQLiteAccountStore 实现
 * - 工厂函数用于创建存储实例
 *
 * 设计理念：
 * - 极简接口：只包含 8 个核心方法（load/reload/save/list/get/add/update/remove/find）
 * - 存储透明：调用方无需关心底层是 JSON 还是 SQLite
 * - 性能优化：JSON 使用内存缓存 + 防抖保存；SQLite 直接查询
 * - 易于扩展：新增存储方式只需实��� AccountStore 接口
 *
 * @module account
 */

// ==================== 导出接口定义 ====================

export { AccountStore } from './interface.js';

// ==================== 导出具体实现 ====================

export { JSONAccountStore } from './json.js';
export { SQLiteAccountStore } from './sqlite.js';

// ==================== 导出工厂函数 ====================

export {
    createAccountStore,
    clearAccountStoreCache,
    getCachedAccountStores,
    getDefaultStoreType
} from './factory.js';

// ==================== 重新导出（便于默认导入） ====================

/**
 * 账号存储模块的默认导出
 *
 * 提供所有接口和工厂函数的统一访问。
 */
export { default } from './factory.js';
