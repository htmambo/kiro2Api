'use client';

import { useState, useEffect, useRef } from 'react';
import { Trash2, Download, RefreshCw, Filter, Search } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'error';
  message: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterLevel, setFilterLevel] = useState<'all' | 'info' | 'error'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs, autoScroll]);

  // 获取日志
  const fetchLogs = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/logs', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('获取日志失败');
      }

      const data = await response.json();
      setLogs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取日志失败');
    } finally {
      setLoading(false);
    }
  };

  // 清空日志
  const clearLogs = async () => {
    if (!confirm('确定要清空所有日志吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/logs', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('清空日志失败');
      }

      setLogs([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空日志失败');
    }
  };

  // 导出日志
  const exportLogs = () => {
    const dataStr = JSON.stringify(logs, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `logs-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 过滤日志
  useEffect(() => {
    let filtered = logs;

    // 按级别过滤
    if (filterLevel !== 'all') {
      filtered = filtered.filter(log => log.level === filterLevel);
    }

    // 按搜索关键词过滤
    if (searchQuery) {
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredLogs(filtered);
  }, [logs, filterLevel, searchQuery]);

  // 初始化：获取日志并建立 SSE 连接
  useEffect(() => {
    fetchLogs();

    // 建立 SSE 连接以接收实时日志
    const eventSource = new EventSource('/api/events');
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('log', (event) => {
      try {
        const logEntry = JSON.parse(event.data);
        setLogs(prev => {
          const newLogs = [...prev, logEntry];
          // 保持最多 100 条日志
          if (newLogs.length > 100) {
            return newLogs.slice(-100);
          }
          return newLogs;
        });
      } catch (err) {
        console.error('解析日志事件失败:', err);
      }
    });

    eventSource.onerror = (err) => {
      console.error('SSE 连接错误:', err);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // 格式化时间戳
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  // 获取日志级别样式
  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'info':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">加载日志中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">系统日志</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          查看系统运行日志，最多保留 100 条最新记录
        </p>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* 工具栏 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          {/* 左侧：搜索和过滤 */}
          <div className="flex flex-col sm:flex-row gap-3 flex-1 w-full sm:w-auto">
            {/* 搜索框 */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索日志..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* 级别过滤 */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value as 'all' | 'info' | 'error')}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">全部级别</option>
                <option value="info">信息</option>
                <option value="error">错误</option>
              </select>
            </div>
          </div>

          {/* 右侧：操作按钮 */}
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={fetchLogs}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
            <button
              onClick={exportLogs}
              disabled={logs.length === 0}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" />
              导出
            </button>
            <button
              onClick={clearLogs}
              disabled={logs.length === 0}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4" />
              清空
            </button>
          </div>
        </div>

        {/* 自动滚动开关 */}
        <div className="mt-4 flex items-center gap-2">
          <input
            type="checkbox"
            id="autoScroll"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
          />
          <label htmlFor="autoScroll" className="text-sm text-gray-700 dark:text-gray-300">
            自动滚动到最新日志
          </label>
        </div>
      </div>

      {/* 日志统计 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">总日志数</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {filteredLogs.length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">信息日志</div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
            {filteredLogs.filter(log => log.level === 'info').length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">错误日志</div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
            {filteredLogs.filter(log => log.level === 'error').length}
          </div>
        </div>
      </div>

      {/* 日志列表 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">日志记录</h2>
        </div>
        <div className="p-4 max-h-[600px] overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              {searchQuery || filterLevel !== 'all' ? '没有符合条件的日志' : '暂无日志记录'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLogs.map((log, index) => (
                <div
                  key={index}
                  className="flex gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  {/* 时间戳 */}
                  <div className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400 font-mono w-36">
                    {formatTimestamp(log.timestamp)}
                  </div>

                  {/* 级别标签 */}
                  <div className="flex-shrink-0">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getLevelStyle(log.level)}`}>
                      {log.level.toUpperCase()}
                    </span>
                  </div>

                  {/* 日志消息 */}
                  <div className="flex-1 text-sm text-gray-900 dark:text-gray-100 font-mono break-all">
                    {log.message}
                  </div>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
