/* eslint-disable i18next/no-literal-string */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, Check, ChevronDown, Download, X } from 'lucide-react';
import { Content, Portal, Root, Trigger } from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { TooltipAnchor, useToastContext } from '@librechat/client';
import { apiBaseUrl, request } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import {
  getSanSuoIndustryMaterialIds,
  getSanSuoMode,
  moveSanSuoIndustryMaterials,
  setSanSuoIndustryMaterialIds,
  setSanSuoSelection,
  SANSUO_MODE_EVENT,
} from '~/utils/sansuoMode';

type IndustryMaterial = {
  materialId: string;
  name: string;
  description?: string;
  version?: string;
  sourceFiles?: Array<{ sourceId: string; filename: string }>;
};
type UiConfig = { knowledgeSources?: { materialsLabel?: string } };

export default function IndustryMaterialsMenu({
  disabled,
  conversationId,
}: {
  disabled: boolean;
  conversationId?: string | null;
}) {
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(() => getSanSuoMode());
  const [materialIds, setMaterialIds] = useState(() =>
    getSanSuoIndustryMaterialIds(conversationId),
  );
  const previousConversationId = useRef(conversationId);
  const materialsQuery = useQuery<IndustryMaterial[]>(
    ['sansuo-industry-materials', user?.id],
    () => request.get(`${apiBaseUrl()}/api/sansuo-ui/materials`),
    { enabled: Boolean(user), staleTime: 60_000, retry: false },
  );
  const configQuery = useQuery<UiConfig>(
    ['sansuo-ui-config', user?.id],
    () => request.get(`${apiBaseUrl()}/api/sansuo-ui/config`),
    { enabled: Boolean(user), staleTime: 60_000 },
  );
  const materials = useMemo(
    () => (Array.isArray(materialsQuery.data) ? materialsQuery.data : []),
    [materialsQuery.data],
  );
  const selected = useMemo(
    () => materialIds.map((id) => materials.find((item) => item.materialId === id)).filter(Boolean),
    [materialIds, materials],
  ) as IndustryMaterial[];
  const label = configQuery.data?.knowledgeSources?.materialsLabel || '行业资料';
  let summary = label;
  if (selected.length === 1) {
    summary = `已挂载《${selected[0].name}》`;
  } else if (selected.length > 1) {
    summary = `已挂载《${selected[0].name}》等 ${selected.length} 份`;
  }

  useEffect(() => {
    const update = () => {
      setMode(getSanSuoMode());
      setMaterialIds(getSanSuoIndustryMaterialIds(conversationId));
    };
    update();
    window.addEventListener(SANSUO_MODE_EVENT, update);
    return () => window.removeEventListener(SANSUO_MODE_EVENT, update);
  }, [conversationId]);

  useEffect(() => {
    const previous = previousConversationId.current;
    if (previous && conversationId && previous !== conversationId && /new/i.test(previous)) {
      moveSanSuoIndustryMaterials(previous, conversationId);
    }
    previousConversationId.current = conversationId;
    setMaterialIds(getSanSuoIndustryMaterialIds(conversationId));
  }, [conversationId]);

  const applySelection = async (next: string[], changed?: IndustryMaterial, mounted = true) => {
    if (mode === 'knowledge' && next.length > 0) {
      setSanSuoSelection('fast', '', next, conversationId);
      try {
        await request.put(`${apiBaseUrl()}/api/sansuo-ui/preferences`, {
          answerMode: 'fast',
          knowledgeAgentId: null,
        });
      } catch {
        showToast({ message: '资料已临时挂载，但快速模式偏好保存失败。', status: 'error' });
      }
    } else {
      setSanSuoIndustryMaterialIds(next, conversationId);
    }
    if (changed) {
      showToast({
        message: mounted ? `已挂载《${changed.name}》` : `已卸载《${changed.name}》`,
        status: 'success',
      });
    }
  };

  return (
    <Root open={open} onOpenChange={setOpen}>
      <TooltipAnchor
        description={selected.length ? summary : `挂载${label}`}
        render={
          <Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={summary}
              className={cn(
                'flex h-9 max-w-[min(19rem,42vw)] items-center gap-1.5 rounded-full border px-2.5 text-sm transition-all duration-200 disabled:opacity-50',
                selected.length
                  ? 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300'
                  : 'border-border-light text-text-secondary hover:bg-surface-hover hover:text-text-primary',
              )}
            >
              <BookMarked className="h-4 w-4 shrink-0" />
              <span className="truncate">{summary}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
          </Trigger>
        }
      />
      <Portal>
        <Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-[100] w-[min(23rem,calc(100vw-24px))] rounded-lg border border-border-light bg-surface-primary p-2 text-text-primary shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-0.5">
            <span className="text-sm font-medium">{label}（可多选）</span>
            <span className="text-xs text-text-secondary">{materialIds.length}/5</span>
          </div>
          {materials.map((material) => {
            const isSelected = materialIds.includes(material.materialId);
            return (
              <div key={material.materialId} className="rounded-md hover:bg-surface-hover">
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 px-2 py-2 text-left"
                  onClick={() => {
                    const next = isSelected
                      ? materialIds.filter((id) => id !== material.materialId)
                      : [...materialIds, material.materialId].slice(0, 5);
                    void applySelection(next, material, !isSelected);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{material.name}</span>
                    {(material.version || material.description) && (
                      <span className="mt-0.5 block truncate text-xs text-text-secondary">
                        {material.version || material.description}
                      </span>
                    )}
                  </span>
                  {isSelected && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
                </button>
                {isSelected &&
                  material.sourceFiles?.map((file) => (
                    <a
                      key={file.sourceId}
                      href={`${apiBaseUrl()}/api/sansuo-ui/materials/${encodeURIComponent(material.materialId)}/sources/${encodeURIComponent(file.sourceId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mx-2 mb-1 flex items-center gap-1.5 truncate rounded px-1 py-1 text-xs text-text-secondary hover:text-text-primary"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{file.filename}</span>
                    </a>
                  ))}
              </div>
            );
          })}
          {materials.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-text-secondary">
              暂无可用行业资料
            </div>
          )}
          {materialIds.length > 0 && (
            <>
              <div className="my-1 border-t border-border-light" />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                onClick={() => void applySelection([])}
              >
                <X className="h-4 w-4" />
                卸载全部资料
              </button>
            </>
          )}
        </Content>
      </Portal>
    </Root>
  );
}
