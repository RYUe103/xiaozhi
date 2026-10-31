/* eslint-disable i18next/no-literal-string */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileDown, ImagePlus, Plus, Save, Trash2, Upload } from 'lucide-react';
import { apiBaseUrl, request } from 'librechat-data-provider';
import { cn } from '~/utils';

type Resource = { assetId?: string; sourceId?: string; filename: string; bytes: number };
type Material = {
  materialId: string;
  name: string;
  description: string;
  version: string;
  markdown?: string;
  contentChars?: number;
  enabled: boolean;
  published: boolean;
  sortOrder: number;
  allowedUserIds: string[];
  assets: Resource[];
  sourceFiles: Resource[];
};
const empty = (): Material => ({
  materialId: '',
  name: '',
  description: '',
  version: '',
  markdown: '',
  contentChars: 0,
  enabled: true,
  published: false,
  sortOrder: 0,
  allowedUserIds: [],
  assets: [],
  sourceFiles: [],
});

function normalizeMaterial(value?: Partial<Material> | null): Material {
  const normalized: Material = {
    ...empty(),
    ...(value ?? {}),
    allowedUserIds: Array.isArray(value?.allowedUserIds) ? value.allowedUserIds : [],
    assets: Array.isArray(value?.assets) ? value.assets : [],
    sourceFiles: Array.isArray(value?.sourceFiles) ? value.sourceFiles : [],
  };
  if (typeof value?.markdown !== 'string') {
    delete normalized.markdown;
  }
  return normalized;
}

const base = () => `${apiBaseUrl()}/api/admin/sansuo-data`;

export default function SanSuoIndustryMaterialsAdmin({
  setMessage,
}: {
  setMessage: (value: string) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [hasPendingMarkdown, setHasPendingMarkdown] = useState(false);
  const [draft, setDraft] = useState<Material>(empty);
  const markdownInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const query = useQuery<Material[]>(['sansuo-admin-industry-materials'], () =>
    request.get<Material[]>(`${base()}/industry-materials`),
  );
  useEffect(() => {
    if (!isCreating && !selectedId && Array.isArray(query.data) && query.data.length) {
      setSelectedId(query.data[0].materialId);
      setDraft(normalizeMaterial(query.data[0]));
    }
  }, [isCreating, query.data, selectedId]);
  useEffect(() => {
    if (isCreating || hasPendingMarkdown) return;
    const current = Array.isArray(query.data)
      ? query.data.find((item) => item.materialId === selectedId)
      : undefined;
    if (current) {
      const normalized = normalizeMaterial(current);
      setDraft((previous) =>
        JSON.stringify(previous) === JSON.stringify(normalized) ? previous : normalized,
      );
    }
  }, [hasPendingMarkdown, isCreating, query.data, selectedId]);
  const save = useMutation(
    (value: Material) =>
      selectedId
        ? request.put(`${base()}/industry-materials/${encodeURIComponent(selectedId)}`, value)
        : request.post(`${base()}/industry-materials`, value),
    {
      onSuccess: (value: Material) => {
        setIsCreating(false);
        setHasPendingMarkdown(false);
        setSelectedId(value.materialId);
        setDraft(normalizeMaterial(value));
        setMessage(`行业资料“${value.name}”已保存。`);
        queryClient.invalidateQueries(['sansuo-admin-industry-materials']);
        queryClient.invalidateQueries(['sansuo-industry-materials']);
      },
      onError: (error: Error) => setMessage(error.message || '行业资料保存失败。'),
    },
  );
  const archive = useMutation(
    (id: string) => request.delete(`${base()}/industry-materials/${encodeURIComponent(id)}`),
    {
      onSuccess: () => {
        setIsCreating(true);
        setHasPendingMarkdown(false);
        setSelectedId('');
        setDraft(empty());
        setMessage('行业资料已停用。');
        queryClient.invalidateQueries(['sansuo-admin-industry-materials']);
        queryClient.invalidateQueries(['sansuo-industry-materials']);
      },
    },
  );
  const upload = async (kind: 'assets' | 'sources', file?: File) => {
    if (!file || !selectedId) return;
    const form = new FormData();
    form.append('file', file);
    await request.postMultiPart(
      `${base()}/industry-materials/${encodeURIComponent(selectedId)}/${kind}`,
      form,
    );
    setMessage(kind === 'assets' ? '图片已上传。' : '原始来源文件已上传，仅供下载。');
    await queryClient.invalidateQueries(['sansuo-admin-industry-materials']);
  };
  const removeResource = async (kind: 'assets' | 'sources', id: string) => {
    await request.delete(
      `${base()}/industry-materials/${encodeURIComponent(selectedId)}/${kind}/${encodeURIComponent(id)}`,
    );
    await queryClient.invalidateQueries(['sansuo-admin-industry-materials']);
  };
  const update = (patch: Partial<Material>) => setDraft((value) => ({ ...value, ...patch }));
  const contentChars = Number(draft.contentChars || 0);
  let markdownStatus = '尚未导入 Markdown。';
  if (hasPendingMarkdown) {
    markdownStatus = `已读取新文件 ${contentChars.toLocaleString()} 字符，保存后将替换原正文。`;
  } else if (contentChars > 0) {
    markdownStatus = `已保存 ${contentChars.toLocaleString()} 字符，正文不在页面中加载。`;
  }
  const inputClass =
    'h-10 rounded-lg border border-border-light bg-surface-primary px-3 text-sm outline-none focus:border-border-medium';
  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-border-light bg-surface-primary">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-4 py-4">
        <div>
          <div className="text-sm text-text-secondary">本地 Markdown 上下文</div>
          <h2 className="mt-1 text-lg font-semibold">行业资料</h2>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            setHasPendingMarkdown(false);
            setSelectedId('');
            setDraft(empty());
          }}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-light px-3 text-sm hover:bg-surface-hover"
        >
          <Plus className="h-4 w-4" />
          新增资料
        </button>
      </header>
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-border-light lg:border-b-0 lg:border-r">
          {(Array.isArray(query.data) ? query.data : []).map((item) => (
            <button
              type="button"
              key={item.materialId}
              onClick={() => {
                setIsCreating(false);
                setHasPendingMarkdown(false);
                setSelectedId(item.materialId);
                setDraft(normalizeMaterial(item));
              }}
              className={cn(
                'flex w-full items-start gap-3 border-b border-border-light px-4 py-3 text-left hover:bg-surface-hover',
                selectedId === item.materialId && 'bg-surface-active-alt',
              )}
            >
              <span
                className={cn(
                  'mt-1.5 h-2 w-2 rounded-full',
                  item.enabled && item.published ? 'bg-green-500' : 'bg-text-secondary/40',
                )}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="block truncate text-xs text-text-secondary">
                  {item.version || item.materialId}
                </span>
              </span>
            </button>
          ))}
          {!query.isLoading && (!Array.isArray(query.data) || query.data.length === 0) && (
            <p className="px-4 py-6 text-sm text-text-secondary">暂无行业资料。</p>
          )}
        </aside>
        <form
          className="grid gap-4 p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">{selectedId ? '编辑资料' : '新增资料'}</h3>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />
                允许选择
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(e) => update({ published: e.target.checked })}
                />
                已发布
              </label>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-text-secondary">资料标识</span>
              <input
                required
                disabled={!!selectedId}
                value={draft.materialId}
                onChange={(e) => update({ materialId: e.target.value })}
                className={inputClass}
                placeholder="例如：pipeline-terms"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-text-secondary">显示名称</span>
              <input
                required
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-text-secondary">版本</span>
              <input
                value={draft.version}
                onChange={(e) => update({ version: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-text-secondary">排序</span>
              <input
                type="number"
                value={draft.sortOrder}
                onChange={(e) => update({ sortOrder: Number(e.target.value) })}
                className={inputClass}
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-text-secondary">说明</span>
            <input
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-light px-3 py-3 text-sm">
            <div>
              <div className="font-medium">Markdown 正文</div>
              <div className="mt-0.5 text-xs text-text-secondary">{markdownStatus}</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={markdownInput}
                type="file"
                accept=".md,text/markdown,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    file.text().then((markdown) => {
                      update({ markdown, contentChars: markdown.length });
                      setHasPendingMarkdown(true);
                      setMessage('已读取新的 Markdown；点击“保存资料”后才会替换原正文。');
                    });
                  }
                  e.target.value = '';
                }}
              />
              {selectedId && contentChars > 0 && (
                <a
                  href={`${base()}/industry-materials/${encodeURIComponent(selectedId)}/markdown`}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border-light px-2 text-xs hover:bg-surface-hover"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出 MD
                </a>
              )}
              <button
                type="button"
                onClick={() => markdownInput.current?.click()}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border-light px-2 text-xs hover:bg-surface-hover"
              >
                <Upload className="h-3.5 w-3.5" />
                {selectedId ? '替换 MD' : '导入 MD'}
              </button>
            </div>
          </div>
          {selectedId && (
            <div className="grid gap-4 border-t border-border-light pt-4 md:grid-cols-2">
              <ResourcePanel
                title="图片资源"
                note="可在回答中按需展示。"
                items={draft.assets}
                idKey="assetId"
                button={
                  <>
                    <input
                      ref={imageInput}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.gif"
                      className="hidden"
                      onChange={(e) => {
                        void upload('assets', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => imageInput.current?.click()}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border-light px-2 text-xs hover:bg-surface-hover"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      上传图片
                    </button>
                  </>
                }
                onRemove={(id) => removeResource('assets', id)}
              />
              <ResourcePanel
                title="原始来源文件"
                note="仅供用户查看和下载，不参与模型回答。"
                items={draft.sourceFiles}
                idKey="sourceId"
                button={
                  <>
                    <input
                      ref={sourceInput}
                      type="file"
                      accept=".pdf,.ppt,.pptx,.doc,.docx"
                      className="hidden"
                      onChange={(e) => {
                        void upload('sources', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => sourceInput.current?.click()}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border-light px-2 text-xs hover:bg-surface-hover"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      上传来源
                    </button>
                  </>
                }
                onRemove={(id) => removeResource('sources', id)}
              />
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-border-light pt-4">
            {selectedId && (
              <button
                type="button"
                onClick={() =>
                  window.confirm('确认停用这份行业资料？') && archive.mutate(selectedId)
                }
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-500/40 px-3 text-sm text-red-600"
              >
                <Trash2 className="h-4 w-4" />
                停用
              </button>
            )}
            <button
              type="submit"
              disabled={save.isLoading}
              className="bg-surface-inverse text-text-inverse inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              保存资料
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function ResourcePanel({
  title,
  note,
  items,
  idKey,
  button,
  onRemove,
}: {
  title: string;
  note: string;
  items: Resource[];
  idKey: 'assetId' | 'sourceId';
  button: ReactNode;
  onRemove: (id: string) => void;
}) {
  const resources = Array.isArray(items) ? items : [];

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="text-xs text-text-secondary">{note}</p>
        </div>
        {button}
      </div>
      <div className="mt-2 divide-y divide-border-light rounded-lg border border-border-light">
        {resources.map((item) => (
          <div
            key={item[idKey]}
            className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate">{item.filename}</span>
            <button
              type="button"
              title="删除"
              onClick={() => onRemove(item[idKey] || '')}
              className="shrink-0 p-1 text-text-secondary hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {resources.length === 0 && (
          <p className="px-3 py-3 text-xs text-text-secondary">暂无文件</p>
        )}
      </div>
    </div>
  );
}
