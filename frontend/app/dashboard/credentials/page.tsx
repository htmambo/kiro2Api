'use client';

import { useEffect, useState } from 'react';
import {
  IconFile,
  IconTrash,
  IconEye,
  IconRefresh,
  IconSearch,
  IconCheck,
  IconX,
  IconKey,
  IconLock,
  IconFileText,
  IconLoader2,
  IconLink
} from '@tabler/icons-react';
import { CardSpotlight } from '@/components/ui/card-spotlight';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageLoadingSkeleton } from '@/components/ui/skeleton';
import { fetchWithAuth, isUnauthorizedError } from '@/lib/apiClient';

interface CredentialFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  type: string;
  isUsed: boolean;
  usedBy?: string[];
}

interface BulkLinkResult {
  filePath: string;
  success: boolean;
  message: string;
  alreadyLinked?: boolean;
}

interface BulkLinkSummary {
  attempted: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  results: BulkLinkResult[];
}

const getErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = await response.clone().json();
    if (payload?.error?.message) {
      return payload.error.message;
    }
    if (payload?.message) {
      return payload.message;
    }
  } catch {
    // ignore parse errors
  }
  return fallback;
};

export default function CredentialsPage() {
  const toast = useToast();
  const [credentials, setCredentials] = useState<CredentialFile[]>([]);
  const [filteredCredentials, setFilteredCredentials] = useState<CredentialFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'used' | 'unused'>('all');
  const [selectedFile, setSelectedFile] = useState<CredentialFile | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [showModal, setShowModal] = useState(false);
  const [linkingPaths, setLinkingPaths] = useState<Set<string>>(new Set());
  const [bulkLinking, setBulkLinking] = useState(false);
  const [bulkLinkSummary, setBulkLinkSummary] = useState<BulkLinkSummary | null>(null);

  useEffect(() => {
    loadCredentials();
  }, []);

  useEffect(() => {
    filterCredentials();
  }, [credentials, searchTerm, statusFilter]);

  const loadCredentials = async (options?: { clearBulkSummary?: boolean }) => {
    setRefreshing(true);
    if (options?.clearBulkSummary !== false) {
      setBulkLinkSummary(null); // 清除批量关联结果
    }
    const startTime = Date.now();
    try {
      const response = await fetchWithAuth('/api/upload-configs');
      if (!response.ok) {
        const message = await getErrorMessage(response, '加载凭据失败');
        throw new Error(message);
      }
      const data = await response.json();
      setCredentials(data);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return;
      }
      console.error('Failed to load credentials:', error);
      toast.error('加载凭据失败', error instanceof Error ? error.message : undefined);
    } finally {
      const elapsed = Date.now() - startTime;
      const minDelay = 800;
      if (elapsed < minDelay) {
        await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
      }
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filterCredentials = () => {
    let filtered = credentials;

    if (searchTerm) {
      filtered = filtered.filter(cred =>
        cred.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cred.path.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(cred =>
        statusFilter === 'used' ? cred.isUsed : !cred.isUsed
      );
    }

    setFilteredCredentials(filtered);
  };

  const viewFile = async (file: CredentialFile) => {
    try {
      const response = await fetchWithAuth(`/api/upload-configs/view/${encodeURIComponent(file.path)}`);
      if (!response.ok) {
        const message = await getErrorMessage(response, '加载失败');
        throw new Error(message);
      }
      const data = await response.json();
      setFileContent(data.content || JSON.stringify(data, null, 2));
      setSelectedFile(file);
      setShowModal(true);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return;
      }
      console.error('Failed to load file content:', error);
      toast.error('加载失败', error instanceof Error ? error.message : '加载文件内容失败');
    }
  };

  const deleteFile = async (filePath: string) => {
    if (!confirm('确定要删除此文件吗？此操作不可撤销。')) {
      return;
    }

    try {
      const response = await fetchWithAuth(`/api/upload-configs/delete/${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const message = await getErrorMessage(response, '删除失败');
        throw new Error(message);
      }

      await loadCredentials();
      toast.success('删除成功', '文件已删除');
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return;
      }
      console.error('Failed to delete file:', error);
      toast.error('删除失败', error instanceof Error ? error.message : undefined);
    }
  };

  const linkFile = async (filePath: string) => {
    // 防止重复点击
    setLinkingPaths(prev => {
      if (prev.has(filePath)) return prev;
      const next = new Set(prev);
      next.add(filePath);
      return next;
    });

    try {
      const response = await fetchWithAuth('/api/quick-link-provider', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filePath }),
      });

      if (!response.ok) {
        const message = await getErrorMessage(response, '关联失败');
        throw new Error(message);
      }

      const data = await response.json();

      // 检查响应体中的 success 字段
      if (!data?.success) {
        throw new Error(data?.message || data?.error?.message || '关联失败');
      }

      await loadCredentials();
      toast.success('关联成功', data?.message || '凭据已关联');
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return;
      }
      console.error('Failed to link credential file:', error);
      toast.error('关联失败', error instanceof Error ? error.message : undefined);
    } finally {
      setLinkingPaths(prev => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    }
  };

  const handleBulkLink = async () => {
    if (bulkLinking) return;

    // 获取所有未使用的文件
    const unusedFiles = credentials.filter(file => !file.isUsed);

    if (unusedFiles.length === 0) {
      toast.info('当前没有未关联的凭据文件');
      return;
    }

    setBulkLinking(true);
    setBulkLinkSummary(null);

    try {
      const response = await fetchWithAuth('/api/quick-link-provider/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filePaths: unusedFiles.map(file => file.path) }),
      });

      if (!response.ok) {
        const message = await getErrorMessage(response, '批量关联失败');
        throw new Error(message);
      }

      const data = await response.json();

      if (!data?.success) {
        throw new Error(data?.message || data?.error?.message || '批量关联失败');
      }

      // 设置汇总信息
      const summary: BulkLinkSummary = {
        attempted: data.summary?.attempted || unusedFiles.length,
        successCount: data.summary?.successCount || 0,
        failureCount: data.summary?.failureCount || 0,
        skippedCount: data.summary?.skippedCount || 0,
        results: data.results || []
      };

      setBulkLinkSummary(summary);

      // 根据结果显示不同的提示
      if (summary.successCount === 0 && summary.failureCount > 0) {
        // 全部失败
        toast.error(
          '批量关联失败',
          `所有文件关联失败，请检查失败详情`
        );
      } else if (summary.failureCount > 0) {
        // 部分失败
        toast.warning(
          '批量关联部分成功',
          `成功 ${summary.successCount} 个，失败 ${summary.failureCount} 个，已关联 ${summary.skippedCount} 个`
        );
      } else {
        // 全部成功
        toast.success(
          '批量关联完成',
          data.message || `成功关联 ${summary.successCount} 个文件${summary.skippedCount > 0 ? `，跳过 ${summary.skippedCount} 个已关联文件` : ''}`
        );
      }

      // 刷新列表（保留批量关联结果）
      await loadCredentials({ clearBulkSummary: false });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return;
      }
      console.error('Failed to bulk link credential files:', error);
      toast.error('批量关联失败', error instanceof Error ? error.message : undefined);
    } finally {
      setBulkLinking(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const getFileTypeIcon = (type: string) => {
    switch (type) {
      case 'oauth':
        return <IconKey className="w-5 h-5 text-blue-400" />;
      case 'api-key':
        return <IconLock className="w-5 h-5 text-green-400" />;
      case 'system-prompt':
        return <IconFileText className="w-5 h-5 text-purple-400" />;
      default:
        return <IconFile className="w-5 h-5 text-gray-400" />;
    }
  };

  const totalFiles = credentials.length;
  const usedFiles = credentials.filter(c => c.isUsed).length;
  const unusedFiles = totalFiles - usedFiles;
  const totalSize = credentials.reduce((sum, c) => sum + c.size, 0);

  if (loading) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">凭据文件管理</h1>
          <p className="text-gray-400">管理 OAuth 凭据和配置文件</p>
        </div>
        <button
          onClick={() => loadCredentials()}
          disabled={refreshing}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-lg font-semibold transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/50 disabled:opacity-50"
        >
          {refreshing ? (
            <IconLoader2 className="w-5 h-5 animate-spin" />
          ) : (
            <IconRefresh className="w-5 h-5" />
          )}
          <span>{refreshing ? '刷新中...' : '刷新列表'}</span>
        </button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="animate-scale-in delay-100">
          <CardSpotlight>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <IconFile className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-400 text-sm">总文件数</p>
                <h3 className="text-2xl font-bold">{totalFiles}</h3>
              </div>
            </div>
          </CardSpotlight>
        </div>

        <div className="animate-scale-in delay-200">
          <CardSpotlight>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <IconCheck className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-400 text-sm">已使用</p>
                <h3 className="text-2xl font-bold">{usedFiles}</h3>
              </div>
            </div>
          </CardSpotlight>
        </div>

        <div className="animate-scale-in delay-300">
          <CardSpotlight>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                <IconX className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-400 text-sm">未使用</p>
                <h3 className="text-2xl font-bold">{unusedFiles}</h3>
              </div>
            </div>
          </CardSpotlight>
        </div>

        <div className="animate-scale-in delay-400">
          <CardSpotlight>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
                <IconFile className="w-6 h-6" />
              </div>
              <div>
                <p className="text-gray-400 text-sm">总大小</p>
                <h3 className="text-2xl font-bold">{formatFileSize(totalSize)}</h3>
              </div>
            </div>
          </CardSpotlight>
        </div>
      </div>

      {/* Search and Filter */}
      <CardSpotlight>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <IconSearch className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索文件名或路径..."
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-4 py-2 rounded-lg transition-all ${
                statusFilter === 'all'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setStatusFilter('used')}
              className={`px-4 py-2 rounded-lg transition-all ${
                statusFilter === 'used'
                  ? 'bg-green-500 text-white'
                  : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              已使用
            </button>
            <button
              onClick={() => setStatusFilter('unused')}
              className={`px-4 py-2 rounded-lg transition-all ${
                statusFilter === 'unused'
                  ? 'bg-orange-500 text-white'
                  : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              未使用
            </button>
            <button
              onClick={handleBulkLink}
              disabled={bulkLinking || unusedFiles === 0}
              className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
                bulkLinking
                  ? 'bg-purple-500/80 text-white cursor-wait'
                  : unusedFiles === 0
                    ? 'bg-white/10 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600'
              }`}
            >
              {bulkLinking ? (
                <IconLoader2 className="w-4 h-4 animate-spin" />
              ) : (
                <IconLink className="w-4 h-4" />
              )}
              <span>{bulkLinking ? '批量关联中...' : '批量关联'}</span>
            </button>
          </div>
        </div>
        {bulkLinkSummary && (
          <div className="mt-4 p-4 bg-white/5 rounded-lg border border-white/10">
            <div className="flex items-start justify-between mb-2">
              <p className="text-sm text-gray-300">
                批量关联结果：共处理 {bulkLinkSummary.attempted} 个文件，
                成功 <span className="text-green-400 font-semibold">{bulkLinkSummary.successCount}</span> 个，
                失败 <span className="text-red-400 font-semibold">{bulkLinkSummary.failureCount}</span> 个，
                已关联 <span className="text-yellow-400 font-semibold">{bulkLinkSummary.skippedCount}</span> 个
              </p>
              <button
                onClick={() => setBulkLinkSummary(null)}
                className="text-gray-400 hover:text-white transition-colors"
                title="清除结果"
              >
                <IconX className="w-4 h-4" />
              </button>
            </div>
            {(() => {
              const failedResults = bulkLinkSummary.results.filter(r => !r.success);
              return failedResults.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-red-300 font-semibold">失败详情：</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {failedResults.slice(0, 5).map((item, index) => (
                      <p key={index} className="text-xs text-red-300 truncate" title={`${item.filePath}: ${item.message}`}>
                        • {item.filePath}: {item.message}
                      </p>
                    ))}
                    {failedResults.length > 5 && (
                      <p className="text-xs text-gray-400 italic">
                        还有 {failedResults.length - 5} 个失败项未显示
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </CardSpotlight>

      {/* Files List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredCredentials.length === 0 ? (
          <CardSpotlight>
            <div className="text-center py-12">
              <p className="text-gray-400 text-lg">暂无凭据文件</p>
              <p className="text-gray-500 text-sm mt-2">请上传 OAuth 凭据文件</p>
            </div>
          </CardSpotlight>
        ) : (
          filteredCredentials.map((file) => (
            <CardSpotlight key={file.path}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  {getFileTypeIcon(file.type)}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{file.name}</h3>
                      {file.isUsed ? (
                        <Badge variant="default" className="bg-green-500">
                          <IconCheck className="w-3 h-3 mr-1" />
                          已使用
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          未使用
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-400 truncate max-w-lg" title={file.path}>
                      {file.path}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                      <span>{formatFileSize(file.size)}</span>
                      <span>{formatDate(file.modified)}</span>
                      {file.usedBy && file.usedBy.length > 0 && (
                        <span className="text-blue-400">
                          关联: {file.usedBy.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!file.isUsed && (
                    <button
                      onClick={() => linkFile(file.path)}
                      disabled={linkingPaths.has(file.path)}
                      className="px-3 py-1.5 text-sm rounded-lg border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {linkingPaths.has(file.path) ? (
                        <IconLoader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <IconLink className="w-4 h-4" />
                      )}
                      <span>{linkingPaths.has(file.path) ? '关联中' : '关联'}</span>
                    </button>
                  )}
                  <button
                    onClick={() => viewFile(file)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:bg-white/5 transition-colors flex items-center gap-1"
                  >
                    <IconEye className="w-4 h-4" />
                    查看
                  </button>
                  <button
                    onClick={() => deleteFile(file.path)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1"
                  >
                    <IconTrash className="w-4 h-4" />
                    删除
                  </button>
                </div>
              </div>
            </CardSpotlight>
          ))
        )}
      </div>

      {/* View Modal */}
      {showModal && selectedFile && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-gray-900 rounded-xl border border-white/10 max-w-4xl w-full max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">{selectedFile.name}</h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
                >
                  关闭
                </button>
              </div>
              <p className="text-sm text-gray-400 mt-1">{selectedFile.path}</p>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
              <pre className="bg-black/50 p-4 rounded-lg border border-white/10 overflow-x-auto">
                <code className="text-sm text-green-400 font-mono">
                  {fileContent}
                </code>
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
