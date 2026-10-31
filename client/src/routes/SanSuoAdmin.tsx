/* eslint-disable i18next/no-literal-string */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Database,
  Download,
  ImagePlus,
  KeyRound,
  Megaphone,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import { apiBaseUrl, request, SystemRoles } from 'librechat-data-provider';
import SkillMarkdownRenderer from '~/components/Skills/display/SkillMarkdownRenderer';
import {
  createEmptyAppLink,
  getSansuoAppIcon,
  sansuoAppIconOptions,
  type SanSuoAppLink,
  type SanSuoUiConfig,
} from '~/components/UnifiedSidebar/sansuoUiConfig';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import SanSuoIndustryMaterialsAdmin from './SanSuoIndustryMaterialsAdmin';

type AdminUser = {
  _id: string;
  name?: string;
  username?: string;
  email?: string;
  provider?: string;
  role?: string;
  createdAt?: string;
  counts?: {
    conversations?: number;
    messages?: number;
    files?: number;
  };
  bytes?: {
    uploadMB?: number;
  };
  usage?: {
    requests?: number;
    fast?: number;
    deep?: number;
    knowledge?: number;
    activeDays?: number;
  };
};

type Summary = {
  counts?: Record<string, number>;
  bytes?: Record<string, number>;
  usage?: {
    counts?: Record<string, number>;
    monthly?: Array<{ _id?: string; count?: number }>;
    knowledgeBases?: KnowledgeUsageRow[];
    apps?: Array<{ _id?: string; count?: number; lastUsedAt?: string }>;
    industryMaterials?: Array<{ _id?: string; count?: number; lastUsedAt?: string }>;
  };
};

type KnowledgeUsageRow = {
  _id?: string;
  name?: string;
  count?: number;
  users?: number;
  success?: number;
  errors?: number;
  timeouts?: number;
  insufficient?: number;
  pending?: number;
  averageDurationMs?: number;
};

type UsageOverview = {
  totals?: Record<string, { count?: number; users?: number }>;
  modes?: Record<string, { count?: number; users?: number }>;
  knowledgeBases?: KnowledgeUsageRow[];
  apps?: Array<{ _id?: string; count?: number; users?: number }>;
  trend?: Array<{ month?: string; count?: number; users?: number }>;
  globalTotals?: {
    users?: number;
    activeUsers?: number;
    conversations?: number;
    messages?: number;
    files?: number;
    uploadMB?: number;
  };
  industryMaterials?: Array<{
    _id?: string;
    name?: string;
    count?: number;
    users?: number;
    lastUsedAt?: string;
  }>;
  pageViews?: Array<{ _id?: string; views?: number; users?: number; lastViewedAt?: string }>;
};

type KnowledgeBaseConfig = {
  knowledgeBaseId: string;
  name: string;
  baseUrl: string;
  agentId: string;
  answerMode: 'agentic_ask' | 'local_model';
  answerPrompt: string;
  enabled: boolean;
  archived?: boolean;
  apiKeyConfigured?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
  updatedAt?: string | null;
};

const emptyKnowledgeBase = (): KnowledgeBaseConfig => ({
  knowledgeBaseId: '',
  name: '',
  baseUrl: '',
  agentId: '',
  answerMode: 'agentic_ask',
  answerPrompt: '',
  enabled: true,
  apiKey: '',
  clearApiKey: false,
});

const base = () => `${apiBaseUrl()}/api/admin/sansuo-data`;

function formatDate(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function knowledgeSuccessRate(item: KnowledgeUsageRow) {
  const completed =
    (item.success ?? 0) + (item.errors ?? 0) + (item.timeouts ?? 0) + (item.insufficient ?? 0);
  return completed > 0 ? `${Math.round(((item.success ?? 0) / completed) * 100)}%` : '-';
}

function formatDuration(value?: number) {
  return value && value > 0 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} 秒` : '-';
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-primary px-4 py-3">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text-primary">{value}</div>
    </div>
  );
}

export default function SanSuoAdmin() {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [activeSection, setActiveSection] = useState<
    'overview' | 'users' | 'sidebar' | 'knowledge' | 'maintenance'
  >('overview');
  const [userPage, setUserPage] = useState(1);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [outputDays, setOutputDays] = useState(90);
  const [message, setMessage] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementImageUrl, setAnnouncementImageUrl] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementShowOnLogin, setAnnouncementShowOnLogin] = useState(false);
  const [knowledgeLabel, setKnowledgeLabel] = useState('大知识库');
  const [materialsLabel, setMaterialsLabel] = useState('行业资料');
  const [materialPromptTemplate, setMaterialPromptTemplate] = useState('');
  const [appLinks, setAppLinks] = useState<SanSuoAppLink[]>([]);
  const [selectedAppLinkId, setSelectedAppLinkId] = useState('');
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('');
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeBaseConfig>(emptyKnowledgeBase);
  const knowledgeSelectionInitialized = useRef(false);
  const announcementImageInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = user?.role === SystemRoles.ADMIN;

  const usersQuery = useQuery<{
    users: AdminUser[];
    pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  }>(
    ['sansuo-admin-users', userPage, filter, appliedFrom, appliedTo],
    () =>
      request.get(
        `${base()}/users?page=${userPage}&pageSize=50&query=${encodeURIComponent(filter)}&from=${appliedFrom}&to=${appliedTo}`,
      ),
    { enabled: isAdmin },
  );

  const usageQuery = useQuery<UsageOverview>(
    ['sansuo-admin-usage-overview', appliedFrom, appliedTo],
    () => request.get(`${base()}/usage/overview?from=${appliedFrom}&to=${appliedTo}`),
    { enabled: isAdmin },
  );

  const summaryQuery = useQuery<Summary>(
    ['sansuo-admin-user-summary', selectedUserId, appliedFrom, appliedTo],
    () =>
      request.get<Summary>(
        `${base()}/users/${selectedUserId}/summary?from=${appliedFrom}&to=${appliedTo}`,
      ),
    { enabled: isAdmin && !!selectedUserId },
  );

  const retentionQuery = useQuery(
    ['sansuo-admin-retention-preview', outputDays],
    () => request.get(`${base()}/retention/outputs-preview?outputDays=${outputDays}`),
    { enabled: isAdmin },
  );

  const uiConfigQuery = useQuery<SanSuoUiConfig>(
    ['sansuo-admin-ui-config'],
    () => request.get<SanSuoUiConfig>(`${base()}/ui-config`),
    { enabled: isAdmin },
  );

  const knowledgeBasesQuery = useQuery<KnowledgeBaseConfig[]>(
    ['sansuo-admin-knowledge-bases'],
    () => request.get<KnowledgeBaseConfig[]>(`${base()}/knowledge-bases`),
    { enabled: isAdmin, retry: false },
  );

  const deletePreviewMutation = useMutation((userId: string) =>
    request.post(`${base()}/users/${userId}/delete-preview`),
  );

  const deleteUserMutation = useMutation(
    (userId: string) =>
      request.delete(`${base()}/users/${userId}?confirm=DELETE_USER_DATA&deleteAccount=true`),
    {
      onSuccess: () => {
        setMessage('用户数据已删除。');
        setSelectedUserId('');
        queryClient.invalidateQueries(['sansuo-admin-users']);
      },
    },
  );

  const cleanupOutputsMutation = useMutation(
    () =>
      request.post(
        `${base()}/retention/cleanup-outputs?outputDays=${outputDays}&confirm=CLEANUP_EXPIRED_OUTPUTS`,
      ),
    {
      onSuccess: () => {
        setMessage('过期输出文件已清理。');
        queryClient.invalidateQueries(['sansuo-admin-retention-preview']);
        queryClient.invalidateQueries(['sansuo-admin-users']);
      },
    },
  );

  const saveUiConfigMutation = useMutation(
    (payload: SanSuoUiConfig) => request.put(`${base()}/ui-config`, payload),
    {
      onSuccess: () => {
        setMessage('公告与侧边栏应用配置已保存。');
        queryClient.invalidateQueries(['sansuo-admin-ui-config']);
        queryClient.invalidateQueries(['sansuo-ui-config']);
      },
    },
  );

  const saveKnowledgeBaseMutation = useMutation(
    (payload: KnowledgeBaseConfig) => {
      const isExisting = Boolean(selectedKnowledgeBaseId);
      const url = isExisting
        ? `${base()}/knowledge-bases/${encodeURIComponent(selectedKnowledgeBaseId)}`
        : `${base()}/knowledge-bases`;
      return isExisting ? request.put(url, payload) : request.post(url, payload);
    },
    {
      onSuccess: (saved: KnowledgeBaseConfig) => {
        setMessage(`知识库“${saved.name}”已保存。`);
        setSelectedKnowledgeBaseId(saved.knowledgeBaseId);
        setKnowledgeDraft({ ...saved, apiKey: '', clearApiKey: false });
        queryClient.invalidateQueries(['sansuo-admin-knowledge-bases']);
        queryClient.invalidateQueries(['sansuo-knowledge-agents']);
      },
      onError: (error: Error) => setMessage(error.message || '知识库保存失败。'),
    },
  );

  const testKnowledgeBaseMutation = useMutation(
    (payload: KnowledgeBaseConfig) =>
      request.post(`${base()}/knowledge-bases/test`, payload) as Promise<{
        ok: boolean;
        message: string;
      }>,
    {
      onSuccess: (result) => setMessage(result.message || '知识库连接成功。'),
      onError: (error: Error) => setMessage(error.message || '知识库连接失败。'),
    },
  );

  const archiveKnowledgeBaseMutation = useMutation(
    (knowledgeBaseId: string) =>
      request.delete(`${base()}/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`),
    {
      onSuccess: () => {
        setMessage('知识库连接已移除，历史聊天引用仍保留。');
        setSelectedKnowledgeBaseId('');
        setKnowledgeDraft(emptyKnowledgeBase());
        queryClient.invalidateQueries(['sansuo-admin-knowledge-bases']);
        queryClient.invalidateQueries(['sansuo-knowledge-agents']);
      },
      onError: (error: Error) => setMessage(error.message || '知识库移除失败。'),
    },
  );

  useEffect(() => {
    const config = uiConfigQuery.data;
    if (!config) {
      return;
    }
    setAnnouncementTitle(config.announcement?.title ?? '公告');
    setAnnouncementImageUrl(config.announcement?.imageUrl ?? '');
    setAnnouncementBody(config.announcement?.body ?? '');
    setAnnouncementShowOnLogin(config.announcement?.showOnLogin === true);
    setKnowledgeLabel(config.knowledgeSources?.knowledgeLabel ?? '大知识库');
    setMaterialsLabel(config.knowledgeSources?.materialsLabel ?? '行业资料');
    setMaterialPromptTemplate(config.knowledgeSources?.materialPromptTemplate ?? '');
    setAppLinks(config.appLinks ?? []);
    setSelectedAppLinkId((current) => current || config.appLinks?.[0]?.id || '');
  }, [uiConfigQuery.data]);

  useEffect(() => {
    const items = knowledgeBasesQuery.data ?? [];
    if (knowledgeSelectionInitialized.current || selectedKnowledgeBaseId || items.length === 0) {
      return;
    }
    knowledgeSelectionInitialized.current = true;
    const first = items[0];
    setSelectedKnowledgeBaseId(first.knowledgeBaseId);
    setKnowledgeDraft({ ...first, apiKey: '', clearApiKey: false });
  }, [knowledgeBasesQuery.data, selectedKnowledgeBaseId]);

  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data?.users]);
  const totals = useMemo(
    () =>
      users.reduce(
        (sum, item) => ({
          conversations: sum.conversations + (item.counts?.conversations ?? 0),
          messages: sum.messages + (item.counts?.messages ?? 0),
          files: sum.files + (item.counts?.files ?? 0),
          uploadMB: sum.uploadMB + (item.bytes?.uploadMB ?? 0),
        }),
        { conversations: 0, messages: 0, files: 0, uploadMB: 0 },
      ),
    [users],
  );
  const filteredUsers = users;

  useEffect(() => {
    setUserPage(1);
  }, [filter]);

  const selectedUser = users.find((item) => item._id === selectedUserId);

  const exportUser = async (target: AdminUser) => {
    const data = await request.get(`${base()}/users/${target._id}/export`);
    const name = target.email || target.username || target._id;
    downloadJson(`sansuo-user-${name}.json`, data);
  };

  const exportAllUsage = async () => {
    const data = await request.get(`${base()}/usage/export?from=${appliedFrom}&to=${appliedTo}`);
    downloadJson(`sansuo-usage-all-${new Date().toISOString().slice(0, 10)}.json`, data);
    setMessage('全部用户使用统计已导出，不包含聊天记录。');
  };

  const previewDelete = async () => {
    if (!selectedUserId) {
      return;
    }
    const preview = await deletePreviewMutation.mutateAsync(selectedUserId);
    downloadJson(`sansuo-delete-preview-${selectedUserId}.json`, preview);
    setMessage('删除预览已导出，请确认后再执行删除。');
  };

  const deleteSelectedUser = async () => {
    if (!selectedUserId || !selectedUser) {
      return;
    }
    const label = selectedUser.email || selectedUser.username || selectedUser._id;
    const ok = window.confirm(
      `确认删除 ${label} 的账号、聊天、文件、记忆和会话数据？此操作不可恢复。`,
    );
    if (!ok) {
      return;
    }
    await deleteUserMutation.mutateAsync(selectedUserId);
  };

  const saveUiConfig = async () => {
    await saveUiConfigMutation.mutateAsync({
      appLinks,
      announcement: {
        title: announcementTitle,
        imageUrl: announcementImageUrl,
        body: announcementBody,
        showOnLogin: announcementShowOnLogin,
      },
      knowledgeSources: {
        knowledgeLabel,
        materialsLabel,
        materialPromptTemplate,
      },
    });
  };

  const selectKnowledgeBase = (item: KnowledgeBaseConfig) => {
    setSelectedKnowledgeBaseId(item.knowledgeBaseId);
    setKnowledgeDraft({ ...item, apiKey: '', clearApiKey: false });
    setMessage('');
  };

  const createKnowledgeBase = () => {
    knowledgeSelectionInitialized.current = true;
    setSelectedKnowledgeBaseId('');
    setKnowledgeDraft(emptyKnowledgeBase());
    setMessage('');
  };

  const updateKnowledgeDraft = (patch: Partial<KnowledgeBaseConfig>) => {
    setKnowledgeDraft((current) => ({ ...current, ...patch }));
  };

  const archiveKnowledgeBase = async () => {
    if (!selectedKnowledgeBaseId) {
      return;
    }
    const ok = window.confirm(
      `移除知识库连接“${knowledgeDraft.name || selectedKnowledgeBaseId}”？它将不再供用户选择，但历史聊天引用仍会保留。`,
    );
    if (ok) {
      await archiveKnowledgeBaseMutation.mutateAsync(selectedKnowledgeBaseId);
    }
  };

  const updateAppLink = (id: string, patch: Partial<SanSuoAppLink>) => {
    setAppLinks((current) =>
      current.map((link) => (link.id === id ? { ...link, ...patch } : link)),
    );
  };

  const removeAppLink = (id: string) => {
    setAppLinks((current) => current.filter((link) => link.id !== id));
  };

  const handleAnnouncementImageFile = (file?: File) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setMessage('请选择图片文件。');
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      setMessage('公告图片请控制在 1.5MB 以内，避免配置过大。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAnnouncementImageUrl(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  if (!isAdmin) {
    return (
      <main className="flex h-full items-center justify-center bg-surface-primary text-text-primary">
        <div className="rounded-lg border border-border-light bg-surface-primary-alt p-8 text-center">
          <Shield className="mx-auto h-8 w-8 text-text-secondary" />
          <h1 className="mt-3 text-xl font-semibold">需要管理员权限</h1>
          <p className="mt-2 text-sm text-text-secondary">请使用管理账号进入该页面。</p>
        </div>
      </main>
    );
  }

  const summaryCounts = summaryQuery.data?.counts ?? {};
  const summaryBytes = summaryQuery.data?.bytes ?? {};
  const retention = retentionQuery.data as
    | { counts?: { expiredOutputFiles?: number }; bytes?: { expiredOutputMB?: number } }
    | undefined;
  const expiredOutputFiles = retentionQuery.isLoading
    ? '...'
    : (retention?.counts?.expiredOutputFiles ?? 0);

  return (
    <main className="h-full overflow-y-auto bg-surface-primary text-text-primary">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
        <header className="flex flex-col gap-3 border-b border-border-light pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Shield className="h-4 w-4" />
              三所管理后台
            </div>
            <h1 className="mt-1 text-2xl font-semibold">账号与数据管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void exportAllUsage()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-light px-3 text-sm hover:bg-surface-hover"
            >
              <Download className="h-4 w-4" />
              导出全部使用数据
            </button>
            <button
              type="button"
              onClick={() => {
                queryClient.invalidateQueries(['sansuo-admin-users']);
                queryClient.invalidateQueries(['sansuo-admin-retention-preview']);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-light px-3 text-sm hover:bg-surface-hover"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>
        </header>

        <nav
          className="flex flex-wrap gap-1 border-b border-border-light pb-1"
          aria-label="管理后台分区"
        >
          {(
            [
              ['overview', '使用概览'],
              ['users', '用户使用'],
              ['sidebar', '侧边栏与公告'],
              ['knowledge', '知识库'],
              ['maintenance', '数据维护'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={cn(
                'rounded-lg px-3 py-2 text-sm transition',
                activeSection === id
                  ? 'bg-text-primary text-surface-primary'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            <span>时间范围</span>
            <input
              type="date"
              value={rangeFrom}
              onChange={(event) => setRangeFrom(event.target.value)}
              className="h-8 rounded-lg border border-border-light bg-surface-primary px-2 text-sm text-text-primary"
            />
            <span>至</span>
            <input
              type="date"
              value={rangeTo}
              onChange={(event) => setRangeTo(event.target.value)}
              className="h-8 rounded-lg border border-border-light bg-surface-primary px-2 text-sm text-text-primary"
            />
            <button
              type="button"
              onClick={() => {
                setAppliedFrom(rangeFrom);
                setAppliedTo(rangeTo);
                setUserPage(1);
              }}
              className="h-8 rounded-lg bg-text-primary px-3 text-sm text-surface-primary"
            >
              查询
            </button>
            <button
              type="button"
              onClick={() => {
                setRangeFrom('');
                setRangeTo('');
                setAppliedFrom('');
                setAppliedTo('');
                setUserPage(1);
              }}
              className="h-8 rounded-lg border border-border-light px-3 text-sm hover:bg-surface-hover"
            >
              全部时间
            </button>
          </div>
        </nav>

        {message && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-300">
            {message}
          </div>
        )}

        {activeSection === 'knowledge' && (
          <>
            <section className="rounded-lg border border-border-light bg-surface-primary p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-text-secondary">聊天知识来源</div>
                  <h2 className="mt-1 text-lg font-semibold">名称与行业资料模板</h2>
                </div>
                <button
                  type="button"
                  onClick={saveUiConfig}
                  disabled={saveUiConfigMutation.isLoading}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-text-primary px-3 text-sm text-surface-primary disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  保存设置
                </button>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="text-text-secondary">大知识库显示名称</span>
                  <input
                    value={knowledgeLabel}
                    onChange={(event) => setKnowledgeLabel(event.target.value)}
                    maxLength={30}
                    className="h-10 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-text-secondary">行业资料显示名称</span>
                  <input
                    value={materialsLabel}
                    onChange={(event) => setMaterialsLabel(event.target.value)}
                    maxLength={30}
                    className="h-10 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium"
                  />
                </label>
                <label className="grid gap-1 text-sm md:col-span-2">
                  <span className="text-text-secondary">行业资料接入提示词模板</span>
                  <textarea
                    value={materialPromptTemplate}
                    onChange={(event) => setMaterialPromptTemplate(event.target.value)}
                    rows={8}
                    className="rounded-lg border border-border-light bg-surface-primary p-3 font-mono text-sm leading-6 outline-none focus:border-border-medium"
                  />
                  <span className="text-xs text-text-secondary">
                    支持变量：{'{{material_names}}'}、{'{{material_versions}}'}、
                    {'{{material_contents}}'}、{'{{user_question}}'}。安全和权限规则由后端固定保留。
                  </span>
                </label>
              </div>
            </section>
            <section className="overflow-hidden rounded-lg border border-border-light bg-surface-primary">
              <div className="flex flex-col gap-3 border-b border-border-light px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Database className="h-4 w-4" />
                    外部 Agentic RAG
                  </div>
                  <h2 className="mt-1 text-lg font-semibold">知识库连接</h2>
                  <p className="mt-1 text-sm text-text-secondary">
                    每个连接可选择由 Agentic RAG 直接回答，或检索后交给三所小智 Answer 模型。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={createKnowledgeBase}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border-light px-3 text-sm transition-colors hover:bg-surface-hover"
                >
                  <Plus className="h-4 w-4" />
                  新增连接
                </button>
              </div>

              <div className="grid min-h-[520px] lg:grid-cols-[300px_minmax(0,1fr)]">
                <div className="border-b border-border-light lg:border-b-0 lg:border-r">
                  <div className="border-b border-border-light px-4 py-3 text-xs font-medium text-text-secondary">
                    已配置知识库
                  </div>
                  <div className="max-h-[520px] overflow-y-auto">
                    {(knowledgeBasesQuery.data ?? []).map((item) => {
                      const selected = selectedKnowledgeBaseId === item.knowledgeBaseId;
                      return (
                        <button
                          key={item.knowledgeBaseId}
                          type="button"
                          onClick={() => selectKnowledgeBase(item)}
                          className={cn(
                            'flex w-full items-start gap-3 border-b border-border-light px-4 py-3 text-left transition-colors last:border-b-0',
                            selected ? 'bg-surface-active-alt' : 'hover:bg-surface-hover',
                          )}
                        >
                          <span
                            className={cn(
                              'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                              item.enabled ? 'bg-green-500' : 'bg-text-secondary/40',
                            )}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-text-primary">
                              {item.name}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-text-secondary">
                              {item.agentId} ·{' '}
                              {item.answerMode === 'agentic_ask'
                                ? 'Agentic RAG 直答'
                                : '自有 Answer'}
                            </span>
                          </span>
                          {item.apiKeyConfigured && (
                            <KeyRound
                              className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary"
                              aria-label="已配置 API Key"
                            />
                          )}
                        </button>
                      );
                    })}
                    {knowledgeBasesQuery.isLoading && (
                      <div className="px-4 py-6 text-sm text-text-secondary">
                        正在读取知识库配置...
                      </div>
                    )}
                    {!knowledgeBasesQuery.isLoading &&
                      (knowledgeBasesQuery.data ?? []).length === 0 && (
                        <div className="px-4 py-6 text-sm leading-6 text-text-secondary">
                          暂无连接。新增后，启用的知识库会出现在聊天输入框上方。
                        </div>
                      )}
                  </div>
                </div>

                <form
                  className="grid content-start gap-5 p-4 sm:p-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveKnowledgeBaseMutation.mutate(knowledgeDraft);
                  }}
                >
                  <div className="flex flex-col gap-2 border-b border-border-light pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold">
                        {selectedKnowledgeBaseId ? '编辑连接' : '新增连接'}
                      </h3>
                      <p className="mt-1 text-xs text-text-secondary">
                        API Key保存后不会再次回显；留空表示保留当前密钥。
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={knowledgeDraft.enabled}
                        onChange={(event) =>
                          updateKnowledgeDraft({ enabled: event.target.checked })
                        }
                        className="h-4 w-4"
                      />
                      允许用户选择
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-text-secondary">知识库标识</span>
                      <input
                        required
                        value={knowledgeDraft.knowledgeBaseId}
                        disabled={Boolean(selectedKnowledgeBaseId)}
                        onChange={(event) =>
                          updateKnowledgeDraft({ knowledgeBaseId: event.target.value })
                        }
                        className="h-10 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium disabled:bg-surface-secondary-alt disabled:text-text-secondary"
                        placeholder="例如：meeting-kb"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-text-secondary">显示名称</span>
                      <input
                        required
                        value={knowledgeDraft.name}
                        onChange={(event) => updateKnowledgeDraft({ name: event.target.value })}
                        className="h-10 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium"
                        placeholder="例如：会议纪要知识库"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm md:col-span-2">
                      <span className="text-text-secondary">知识库平台 Base URL</span>
                      <input
                        required
                        value={knowledgeDraft.baseUrl}
                        onChange={(event) => updateKnowledgeDraft({ baseUrl: event.target.value })}
                        className="h-10 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium"
                        placeholder="http://knowledge.internal:8765"
                      />
                      <span className="text-xs text-text-secondary">
                        填写服务根地址，不要在末尾添加 /api 或 /v1。
                      </span>
                    </label>
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-text-secondary">外部 Agent ID</span>
                      <input
                        required
                        value={knowledgeDraft.agentId}
                        onChange={(event) => updateKnowledgeDraft({ agentId: event.target.value })}
                        className="h-10 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium"
                        placeholder="meeting-agent"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-text-secondary">
                        API Key{knowledgeDraft.apiKeyConfigured ? '（已配置）' : '（可选）'}
                      </span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={knowledgeDraft.apiKey || ''}
                        onChange={(event) =>
                          updateKnowledgeDraft({ apiKey: event.target.value, clearApiKey: false })
                        }
                        className="h-10 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium"
                        placeholder={
                          knowledgeDraft.apiKeyConfigured ? '留空保留当前密钥' : '当前无鉴权可留空'
                        }
                      />
                    </label>
                  </div>

                  <fieldset className="grid gap-2">
                    <legend className="text-sm text-text-secondary">回答方式</legend>
                    <div className="grid grid-cols-2 rounded-lg border border-border-light bg-surface-secondary-alt p-1">
                      {(
                        [
                          ['agentic_ask', 'Agentic RAG 直答'],
                          ['local_model', '自有 Answer 模型'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateKnowledgeDraft({ answerMode: value })}
                          className={cn(
                            'min-h-9 px-3 text-sm transition-colors',
                            knowledgeDraft.answerMode === value
                              ? 'rounded-md bg-surface-primary font-medium text-text-primary shadow-sm'
                              : 'text-text-secondary hover:text-text-primary',
                          )}
                          aria-pressed={knowledgeDraft.answerMode === value}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs leading-5 text-text-secondary">
                      {knowledgeDraft.answerMode === 'agentic_ask'
                        ? '问题直接发送到外部 Agent 的 Ask 接口，不调用三所小智 Answer 模型。'
                        : '先从外部 Agent 检索证据，再由服务端配置的 Answer 模型组织答案。'}
                    </p>
                  </fieldset>

                  {knowledgeDraft.answerMode === 'local_model' && (
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-text-secondary">Answer 系统提示词</span>
                      <textarea
                        value={knowledgeDraft.answerPrompt}
                        onChange={(event) =>
                          updateKnowledgeDraft({ answerPrompt: event.target.value })
                        }
                        rows={9}
                        className="resize-y rounded-lg border border-border-light bg-surface-primary px-3 py-2 font-mono text-sm leading-6 outline-none focus:border-border-medium"
                        placeholder="描述该知识库的回答风格、术语和输出结构。证据约束与引用安全规则由系统强制保留。"
                      />
                    </label>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-t border-border-light pt-4">
                    <button
                      type="button"
                      onClick={() => testKnowledgeBaseMutation.mutate(knowledgeDraft)}
                      disabled={testKnowledgeBaseMutation.isLoading}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-light px-3 text-sm transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      <PlugZap className="h-4 w-4" />
                      {testKnowledgeBaseMutation.isLoading ? '正在测试' : '测试连接'}
                    </button>
                    <button
                      type="submit"
                      disabled={saveKnowledgeBaseMutation.isLoading}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-text-primary px-3 text-sm text-surface-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      {saveKnowledgeBaseMutation.isLoading ? '正在保存' : '保存连接'}
                    </button>
                    {selectedKnowledgeBaseId && (
                      <button
                        type="button"
                        onClick={() => void archiveKnowledgeBase()}
                        disabled={archiveKnowledgeBaseMutation.isLoading}
                        className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        移除连接
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </section>
            <SanSuoIndustryMaterialsAdmin setMessage={setMessage} />
          </>
        )}

        {activeSection === 'overview' && (
          <>
            <section className="grid gap-3 sm:grid-cols-4 xl:grid-cols-6">
              <StatBox
                label="用户总数"
                value={
                  usageQuery.data?.globalTotals?.users ?? usersQuery.data?.pagination?.total ?? 0
                }
              />
              <StatBox label="聊天总数" value={usageQuery.data?.globalTotals?.conversations ?? 0} />
              <StatBox label="消息总数" value={usageQuery.data?.globalTotals?.messages ?? 0} />
              <StatBox label="文件总数" value={usageQuery.data?.globalTotals?.files ?? 0} />
              <StatBox
                label="文件容量"
                value={`${usageQuery.data?.globalTotals?.uploadMB ?? 0} MB`}
              />
              <StatBox label="网页访问" value={usageQuery.data?.totals?.page_view?.count ?? 0} />
              <StatBox label="过期输出文件" value={expiredOutputFiles} />
              <StatBox
                label="可清理输出容量"
                value={`${retention?.bytes?.expiredOutputMB ?? 0} MB`}
              />
              <div className="rounded-lg border border-border-light bg-surface-primary px-4 py-3 xl:col-span-2">
                <label className="text-xs text-text-secondary" htmlFor="output-days">
                  输出文件保留
                </label>
                <select
                  id="output-days"
                  value={outputDays}
                  onChange={(event) => setOutputDays(Number(event.target.value))}
                  className="mt-1 h-9 w-full rounded-lg border border-border-light bg-surface-primary px-2 text-sm"
                >
                  <option value={30}>30 天</option>
                  <option value={90}>90 天</option>
                  <option value={180}>180 天</option>
                </select>
              </div>
            </section>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(560px,1.4fr)]">
              <div className="rounded-lg border border-border-light bg-surface-primary p-4">
                <h2 className="text-base font-semibold">
                  {appliedFrom || appliedTo
                    ? `${appliedFrom || '开始'} 至 ${appliedTo || '现在'} 使用概览`
                    : '全部时间使用概览'}
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <StatBox
                    label="请求总数"
                    value={
                      (usageQuery.data?.totals?.chat_request?.count ?? 0) +
                      (usageQuery.data?.totals?.knowledge_query?.count ?? 0)
                    }
                  />
                  <StatBox label="快速模式" value={usageQuery.data?.modes?.fast?.count ?? 0} />
                  <StatBox label="深度模式" value={usageQuery.data?.modes?.deep?.count ?? 0} />
                  <StatBox label="知识库" value={usageQuery.data?.modes?.knowledge?.count ?? 0} />
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  {(usageQuery.data?.trend ?? []).map((item) => (
                    <div
                      key={item.month}
                      className="flex items-center justify-between border-b border-border-light py-2"
                    >
                      <span>{item.month}</span>
                      <span>
                        {item.count ?? 0} 次 · {item.users ?? 0} 人
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="min-w-0 overflow-hidden rounded-lg border border-border-light bg-surface-primary">
                <div className="border-b border-border-light px-4 py-3">
                  <h2 className="text-base font-semibold">具体知识库使用情况</h2>
                  <p className="mt-1 text-xs text-text-secondary">
                    {appliedFrom || appliedTo ? '按所选时间段统计' : '按全部时间统计'}
                    ，不包含聊天正文。
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="bg-surface-primary-alt text-xs text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-medium">知识库</th>
                        <th className="px-3 py-2 text-right font-medium">请求</th>
                        <th className="px-3 py-2 text-right font-medium">用户</th>
                        <th className="px-3 py-2 text-right font-medium">成功率</th>
                        <th className="px-3 py-2 text-right font-medium">失败/超时</th>
                        <th className="px-3 py-2 text-right font-medium">证据不足</th>
                        <th className="px-3 py-2 text-right font-medium">平均耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(usageQuery.data?.knowledgeBases ?? []).map((item) => (
                        <tr key={item._id} className="border-t border-border-light">
                          <td className="max-w-48 px-3 py-2">
                            <div className="truncate font-medium">
                              {item.name || item._id || '未标识'}
                            </div>
                            {item.name && (
                              <div className="truncate text-xs text-text-secondary">{item._id}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">{item.count ?? 0}</td>
                          <td className="px-3 py-2 text-right">{item.users ?? 0}</td>
                          <td className="px-3 py-2 text-right">{knowledgeSuccessRate(item)}</td>
                          <td className="px-3 py-2 text-right">
                            {(item.errors ?? 0) + (item.timeouts ?? 0)}
                          </td>
                          <td className="px-3 py-2 text-right">{item.insufficient ?? 0}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            {formatDuration(item.averageDurationMs)}
                          </td>
                        </tr>
                      ))}
                      {!usageQuery.isLoading &&
                        (usageQuery.data?.knowledgeBases ?? []).length === 0 && (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-4 py-6 text-center text-sm text-text-secondary"
                            >
                              该时间段暂无大知识库请求。
                            </td>
                          </tr>
                        )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
            <section className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-lg border border-border-light bg-surface-primary p-4">
                <h2 className="text-base font-semibold">侧边栏软件使用</h2>
                <div className="mt-3 divide-y divide-border-light text-sm">
                  {(usageQuery.data?.apps ?? []).map((item) => (
                    <div key={item._id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate">
                        {appLinks.find((link) => link.id === item._id)?.label ||
                          item._id ||
                          '未命名入口'}
                      </span>
                      <span className="shrink-0">
                        {item.count ?? 0} 次 · {item.users ?? 0} 人
                      </span>
                    </div>
                  ))}
                  {!usageQuery.data?.apps?.length && (
                    <div className="py-3 text-sm text-text-secondary">暂无侧边栏使用记录。</div>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-border-light bg-surface-primary p-4">
                <h2 className="text-base font-semibold">行业资料使用</h2>
                <div className="mt-3 divide-y divide-border-light text-sm">
                  {(usageQuery.data?.industryMaterials ?? []).map((item) => (
                    <div key={item._id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate">
                        {item.name || item._id || '未命名资料'}
                      </span>
                      <span className="shrink-0">
                        {item.count ?? 0} 次 · {item.users ?? 0} 人
                      </span>
                    </div>
                  ))}
                  {!usageQuery.data?.industryMaterials?.length && (
                    <div className="py-3 text-sm text-text-secondary">暂无行业资料使用记录。</div>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-border-light bg-surface-primary p-4">
                <h2 className="text-base font-semibold">网页访问量</h2>
                <div className="mt-3 divide-y divide-border-light text-sm">
                  {(usageQuery.data?.pageViews ?? []).map((item) => (
                    <div key={item._id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate">{item._id || '/'}</span>
                      <span className="shrink-0">
                        {item.views ?? 0} 次 · {item.users ?? 0} 人
                      </span>
                    </div>
                  ))}
                  {!usageQuery.data?.pageViews?.length && (
                    <div className="py-3 text-sm text-text-secondary">暂无网页访问记录。</div>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {activeSection === 'maintenance' && (
          <section className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => retentionQuery.refetch()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-light px-3 text-sm hover:bg-surface-hover"
            >
              <Search className="h-4 w-4" />
              预览过期输出
            </button>
            <button
              type="button"
              onClick={() => cleanupOutputsMutation.mutate()}
              disabled={cleanupOutputsMutation.isLoading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-500/40 px-3 text-sm text-red-600 hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              清理过期输出
            </button>
          </section>
        )}

        {activeSection === 'sidebar' && (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
            <div className="rounded-lg border border-border-light bg-surface-primary p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Megaphone className="h-4 w-4" />
                    侧边栏公告
                  </div>
                  <h2 className="mt-1 text-lg font-semibold">公告编辑</h2>
                </div>
                <button
                  type="button"
                  onClick={saveUiConfig}
                  disabled={saveUiConfigMutation.isLoading}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-light px-3 text-sm hover:bg-surface-hover disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  保存公告
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-text-secondary">公告标题</span>
                  <input
                    value={announcementTitle}
                    onChange={(event) => setAnnouncementTitle(event.target.value)}
                    className="h-10 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium"
                    placeholder="例如：三所小智使用公告"
                  />
                </label>
                <div className="grid gap-1 text-sm">
                  <span className="text-text-secondary">公告图片，可选</span>
                  <input
                    ref={announcementImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      handleAnnouncementImageFile(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                  <div className="flex gap-2">
                    <input
                      value={announcementImageUrl}
                      onChange={(event) => setAnnouncementImageUrl(event.target.value)}
                      className="h-10 min-w-0 flex-1 rounded-lg border border-border-light bg-surface-primary px-3 outline-none focus:border-border-medium"
                      placeholder="可粘贴图片 URL，也可以点右侧按钮上传"
                    />
                    <button
                      type="button"
                      onClick={() => announcementImageInputRef.current?.click()}
                      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border-light px-3 hover:bg-surface-hover"
                    >
                      <ImagePlus className="h-4 w-4" />
                      选择图片
                    </button>
                    {announcementImageUrl && (
                      <button
                        type="button"
                        onClick={() => setAnnouncementImageUrl('')}
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border-light text-text-secondary hover:bg-surface-hover"
                        aria-label="清除公告图片"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <label className="grid gap-1 text-sm">
                  <span className="text-text-secondary">公告正文，支持 Markdown 和图片语法</span>
                  <textarea
                    value={announcementBody}
                    onChange={(event) => setAnnouncementBody(event.target.value)}
                    rows={9}
                    className="resize-y rounded-lg border border-border-light bg-surface-primary px-3 py-2 font-mono text-sm outline-none focus:border-border-medium"
                    placeholder={'## 本周公告\n\n- 支持 Markdown\n- 支持图片：![说明](https://...)'}
                  />
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-border-light px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={announcementShowOnLogin}
                    onChange={(event) => setAnnouncementShowOnLogin(event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>用户登录后自动弹出该公告</span>
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-border-light bg-surface-primary p-4">
              <h2 className="text-lg font-semibold">预览与应用入口</h2>
              <div className="mt-3 rounded-xl border border-border-light bg-white p-4 text-[#202123]">
                {announcementImageUrl && (
                  <img
                    src={announcementImageUrl}
                    alt=""
                    className="mb-3 max-h-44 w-full rounded-lg object-cover"
                  />
                )}
                <div className="mb-3 text-base font-semibold">{announcementTitle || '公告'}</div>
                <SkillMarkdownRenderer
                  content={announcementBody || '暂无公告。'}
                  className="markdown prose light w-full max-w-none break-words text-sm leading-6 text-[#202123]"
                />
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">侧边栏应用</div>
                  <div className="text-xs text-text-secondary">
                    设置名称、图标、链接和是否启用。
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = createEmptyAppLink();
                      setAppLinks((current) => [...current, next]);
                      setSelectedAppLinkId(next.id);
                    }}
                    className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-light px-2 text-sm hover:bg-surface-hover"
                  >
                    <Plus className="h-4 w-4" />
                    添加
                  </button>
                  <button
                    type="button"
                    onClick={saveUiConfig}
                    disabled={saveUiConfigMutation.isLoading}
                    className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-light px-2 text-sm hover:bg-surface-hover disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    保存
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 border-b border-border-light pb-4">
                {appLinks.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => setSelectedAppLinkId(link.id)}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm',
                      selectedAppLinkId === link.id
                        ? 'border-text-primary bg-surface-active-alt'
                        : 'border-border-light hover:bg-surface-hover',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          link.enabled === false ? 'bg-text-secondary/40' : 'bg-green-500',
                        )}
                      />
                      <span className="truncate">{link.label || '未命名入口'}</span>
                    </span>
                    <span className="text-xs text-text-secondary">点击编辑</span>
                  </button>
                ))}
                {appLinks.length === 0 && (
                  <div className="text-sm text-text-secondary">
                    还没有侧边栏应用，请点击“添加”。
                  </div>
                )}
              </div>
              <div className="mt-3 grid gap-3">
                {appLinks
                  .filter((link) => link.id === selectedAppLinkId)
                  .map((link) => {
                    const PreviewIcon = getSansuoAppIcon(link.icon);
                    return (
                      <div key={link.id} className="rounded-lg border border-border-light p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
                            <PreviewIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{link.label || '未命名入口'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeAppLink(link.id)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-red-600 hover:bg-red-500/10"
                            aria-label="删除应用入口"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="grid gap-2">
                          <input
                            value={link.label}
                            onChange={(event) =>
                              updateAppLink(link.id, { label: event.target.value })
                            }
                            className="h-9 rounded-lg border border-border-light bg-surface-primary px-2 text-sm outline-none focus:border-border-medium"
                            placeholder="名称，例如：明道云"
                          />
                          <input
                            value={link.url || ''}
                            onChange={(event) =>
                              updateAppLink(link.id, { url: event.target.value })
                            }
                            className="h-9 rounded-lg border border-border-light bg-surface-primary px-2 text-sm outline-none focus:border-border-medium"
                            placeholder="https://..."
                          />
                          <div className="grid gap-2 rounded-lg border border-dashed border-border-light p-3">
                            <div>
                              <div className="text-sm font-medium text-text-primary">
                                进入前提示（可选）
                              </div>
                              <div className="mt-1 text-xs text-text-secondary">
                                填写标题、正文或图片后，用户点击此入口会先看到提示；确认后才打开链接。
                              </div>
                            </div>
                            <input
                              value={link.entryNotice?.title || ''}
                              onChange={(event) =>
                                updateAppLink(link.id, {
                                  entryNotice: {
                                    ...(link.entryNotice || {}),
                                    title: event.target.value,
                                  },
                                })
                              }
                              className="h-9 rounded-lg border border-border-light bg-surface-primary px-2 text-sm outline-none focus:border-border-medium"
                              placeholder="提示标题，例如：访问前请注意"
                            />
                            <textarea
                              value={link.entryNotice?.body || ''}
                              onChange={(event) =>
                                updateAppLink(link.id, {
                                  entryNotice: {
                                    ...(link.entryNotice || {}),
                                    body: event.target.value,
                                  },
                                })
                              }
                              rows={4}
                              className="resize-y rounded-lg border border-border-light bg-surface-primary px-2 py-2 text-sm outline-none focus:border-border-medium"
                              placeholder="提示正文，支持 Markdown"
                            />
                            <input
                              value={link.entryNotice?.imageUrl || ''}
                              onChange={(event) =>
                                updateAppLink(link.id, {
                                  entryNotice: {
                                    ...(link.entryNotice || {}),
                                    imageUrl: event.target.value,
                                  },
                                })
                              }
                              className="h-9 rounded-lg border border-border-light bg-surface-primary px-2 text-sm outline-none focus:border-border-medium"
                              placeholder="提示图片 URL，可选"
                            />
                            <input
                              value={link.entryNotice?.confirmLabel || ''}
                              onChange={(event) =>
                                updateAppLink(link.id, {
                                  entryNotice: {
                                    ...(link.entryNotice || {}),
                                    confirmLabel: event.target.value,
                                  },
                                })
                              }
                              className="h-9 rounded-lg border border-border-light bg-surface-primary px-2 text-sm outline-none focus:border-border-medium"
                              placeholder="确认按钮文字，默认：确认进入"
                            />
                          </div>
                          <div className="grid gap-2">
                            <div className="text-xs font-medium text-text-secondary">选择图标</div>
                            <div className="grid grid-cols-5 gap-2">
                              {sansuoAppIconOptions.map((option) => {
                                const OptionIcon = option.Icon;
                                const selected = (link.icon || 'blocks') === option.value;
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => updateAppLink(link.id, { icon: option.value })}
                                    className={cn(
                                      'flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-xs transition',
                                      selected
                                        ? 'border-text-primary bg-surface-active-alt text-text-primary'
                                        : 'border-border-light text-text-secondary hover:bg-surface-hover',
                                    )}
                                  >
                                    <OptionIcon className="h-4 w-4" />
                                    <span>{option.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-sm text-text-secondary">
                            <input
                              type="checkbox"
                              checked={link.enabled !== false}
                              onChange={(event) =>
                                updateAppLink(link.id, { enabled: event.target.checked })
                              }
                            />
                            显示在侧边栏
                          </label>
                          <label className="grid gap-1 text-sm">
                            <span className="text-text-secondary">可见账号</span>
                            <select
                              multiple
                              value={link.allowedUserIds ?? []}
                              onChange={(event) =>
                                updateAppLink(link.id, {
                                  allowedUserIds: Array.from(
                                    event.target.selectedOptions,
                                    (option) => option.value,
                                  ),
                                })
                              }
                              className="min-h-28 rounded-lg border border-border-light bg-surface-primary px-2 py-2 text-sm outline-none focus:border-border-medium"
                            >
                              {users.map((item) => {
                                const label = item.name || item.username || item.email || item._id;
                                const detail =
                                  item.email && item.email !== label ? ` (${item.email})` : '';
                                return (
                                  <option key={item._id} value={item._id}>
                                    {label}
                                    {detail}
                                  </option>
                                );
                              })}
                            </select>
                            <span className="text-xs text-text-secondary">
                              不选择账号表示所有账号可见；按住 Ctrl/Command 可多选。
                            </span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                {selectedAppLinkId && !appLinks.some((link) => link.id === selectedAppLinkId) && (
                  <div className="text-sm text-text-secondary">请选择一个侧边栏应用。</div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeSection === 'users' && (
          <section className="grid min-h-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border-light">
              <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
                <Search className="h-4 w-4 text-text-secondary" />
                <input
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setUserPage(1);
                  }}
                  placeholder="搜索姓名、账号、邮箱、角色"
                  className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[840px] text-left text-sm">
                  <thead className="border-b border-border-light bg-surface-primary-alt text-xs text-text-secondary">
                    <tr>
                      <th className="px-4 py-3 font-medium">用户</th>
                      <th className="px-4 py-3 font-medium">角色</th>
                      <th className="px-4 py-3 font-medium">来源</th>
                      <th className="px-4 py-3 font-medium">
                        {appliedFrom || appliedTo ? '时间段请求' : '全部请求'}
                      </th>
                      <th className="px-4 py-3 font-medium">快速/深度/知识库</th>
                      <th className="px-4 py-3 font-medium">活跃天数</th>
                      <th className="px-4 py-3 font-medium">文件</th>
                      <th className="px-4 py-3 font-medium">容量</th>
                      <th className="px-4 py-3 font-medium">创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((item) => (
                      <tr
                        key={item._id}
                        className={cn(
                          'cursor-pointer border-b border-border-light hover:bg-surface-hover',
                          selectedUserId === item._id && 'bg-surface-active-alt',
                        )}
                        onClick={() => setSelectedUserId(item._id)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium">{item.name || item.username || '-'}</div>
                          <div className="text-xs text-text-secondary">
                            {item.email || item._id}
                          </div>
                        </td>
                        <td className="px-4 py-3">{item.role}</td>
                        <td className="px-4 py-3">{item.provider}</td>
                        <td className="px-4 py-3">{item.usage?.requests ?? 0}</td>
                        <td className="px-4 py-3 text-xs">
                          {item.usage?.fast ?? 0} / {item.usage?.deep ?? 0} /{' '}
                          {item.usage?.knowledge ?? 0}
                        </td>
                        <td className="px-4 py-3">{item.usage?.activeDays ?? 0}</td>
                        <td className="px-4 py-3">{item.counts?.files ?? 0}</td>
                        <td className="px-4 py-3">{item.bytes?.uploadMB ?? 0} MB</td>
                        <td className="px-4 py-3">{formatDate(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className="rounded-lg border border-border-light p-4">
              <h2 className="text-base font-semibold">用户操作</h2>
              {selectedUser ? (
                <div className="mt-4 flex flex-col gap-4">
                  <div>
                    <div className="font-medium">{selectedUser.name || selectedUser.username}</div>
                    <div className="mt-1 break-all text-xs text-text-secondary">
                      {selectedUser.email}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <StatBox label="聊天" value={summaryCounts.conversations ?? '-'} />
                    <StatBox label="消息" value={summaryCounts.messages ?? '-'} />
                    <StatBox label="文件" value={summaryCounts.files ?? '-'} />
                    <StatBox label="容量" value={`${summaryBytes.uploadMB ?? 0} MB`} />
                    <StatBox
                      label={appliedFrom || appliedTo ? '时间段请求' : '全部请求'}
                      value={summaryQuery.data?.usage?.counts?.chat_request ?? 0}
                    />
                    <StatBox
                      label="知识库"
                      value={summaryQuery.data?.usage?.counts?.knowledge_query ?? 0}
                    />
                  </div>
                  {(summaryQuery.data?.usage?.knowledgeBases ?? []).length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium">具体知识库</h3>
                      <div className="mt-2 divide-y divide-border-light border-y border-border-light text-xs">
                        {(summaryQuery.data?.usage?.knowledgeBases ?? []).map((item) => (
                          <div key={item._id} className="py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="min-w-0 truncate font-medium">
                                {item.name || item._id || '未标识'}
                              </span>
                              <span className="shrink-0">{item.count ?? 0} 次</span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-text-secondary">
                              <span>成功 {item.success ?? 0}</span>
                              <span>失败 {(item.errors ?? 0) + (item.timeouts ?? 0)}</span>
                              <span>证据不足 {item.insufficient ?? 0}</span>
                              <span>{formatDuration(item.averageDurationMs)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(summaryQuery.data?.usage?.apps ?? []).length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium">侧边栏使用</h3>
                      <div className="mt-2 divide-y divide-border-light border-y border-border-light text-xs">
                        {summaryQuery.data?.usage?.apps?.map((item) => (
                          <div key={item._id} className="flex items-center justify-between py-2">
                            <span>
                              {appLinks.find((link) => link.id === item._id)?.label || item._id}
                            </span>
                            <span>{item.count ?? 0} 次</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(summaryQuery.data?.usage?.industryMaterials ?? []).length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium">行业资料使用</h3>
                      <div className="mt-2 divide-y divide-border-light border-y border-border-light text-xs">
                        {summaryQuery.data?.usage?.industryMaterials?.map((item) => (
                          <div key={item._id} className="flex items-center justify-between py-2">
                            <span>{item._id || '未标识资料'}</span>
                            <span>{item.count ?? 0} 次</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => exportUser(selectedUser)}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border-light px-3 text-sm hover:bg-surface-hover"
                  >
                    <Download className="h-4 w-4" />
                    导出 JSON
                  </button>
                  <button
                    type="button"
                    onClick={previewDelete}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border-light px-3 text-sm hover:bg-surface-hover"
                  >
                    <Search className="h-4 w-4" />
                    删除预览
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedUser}
                    disabled={deleteUserMutation.isLoading}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-500/40 px-3 text-sm text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除用户数据
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-sm text-text-secondary">从左侧选择一个用户后再操作。</p>
              )}
            </aside>
            <div className="flex items-center justify-between border-t border-border-light px-4 py-3 text-sm text-text-secondary xl:col-span-2">
              <span>
                共 {usersQuery.data?.pagination?.total ?? 0} 人，第{' '}
                {usersQuery.data?.pagination?.page ?? userPage} /{' '}
                {usersQuery.data?.pagination?.totalPages ?? 1} 页
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={userPage <= 1}
                  onClick={() => setUserPage((page) => page - 1)}
                  className="rounded-lg border border-border-light px-3 py-1.5 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={userPage >= (usersQuery.data?.pagination?.totalPages ?? 1)}
                  onClick={() => setUserPage((page) => page + 1)}
                  className="rounded-lg border border-border-light px-3 py-1.5 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
