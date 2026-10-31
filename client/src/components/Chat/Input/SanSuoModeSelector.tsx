import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Brain, Check, ChevronDown, Zap } from 'lucide-react';
import { Content, Portal, Root, Trigger } from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { useToastContext } from '@librechat/client';
import { apiBaseUrl, request } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import {
  getSanSuoKnowledgeAgentId,
  getSanSuoMode,
  setSanSuoSelection,
  SANSUO_MODE_EVENT,
  type SanSuoMode,
} from '~/utils/sansuoMode';

type Preferences = {
  answerMode: SanSuoMode;
  knowledgeAgentId?: string | null;
};
type KnowledgeAgent = { agentId: string; name: string; description?: string; isDefault?: boolean };

const modes = [
  { value: 'fast' as const, label: '快速', Icon: Zap, description: '仅文字问答，不使用文件工具' },
  { value: 'deep' as const, label: '深度', Icon: Brain, description: '支持附件、图片和文件任务' },
  { value: 'knowledge' as const, label: '知识库', Icon: BookOpen, description: '使用已选内部资料' },
];

export default function SanSuoModeSelector({
  files,
  disabled,
  conversationId,
}: {
  files: Map<string, ExtendedFile>;
  disabled: boolean;
  conversationId?: string | null;
}) {
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const [mode, setMode] = useState<SanSuoMode>(() => getSanSuoMode());
  const [knowledgeAgentId, setKnowledgeAgentId] = useState(() => getSanSuoKnowledgeAgentId());
  const [open, setOpen] = useState(false);
  const preferencesQuery = useQuery<Preferences>(
    ['sansuo-preferences', user?.id],
    () => request.get(`${apiBaseUrl()}/api/sansuo-ui/preferences`),
    { enabled: Boolean(user), staleTime: 60_000 },
  );
  const agentsQuery = useQuery<KnowledgeAgent[]>(
    ['sansuo-knowledge-agents', user?.id],
    () => request.get(`${apiBaseUrl()}/api/sansuo-ui/knowledge/agents`),
    { enabled: Boolean(user), staleTime: 60_000, retry: false },
  );
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((item) => item.agentId),
    [agentsQuery.data],
  );
  const selectedAgent = agents.find((item) => item.agentId === knowledgeAgentId);
  const summary = selectedAgent?.name || '选择知识库';

  useEffect(() => {
    const value = preferencesQuery.data;
    if (value) setSanSuoSelection(value.answerMode ?? 'fast', value.knowledgeAgentId);
  }, [preferencesQuery.data]);
  useEffect(() => {
    const update = () => {
      setMode(getSanSuoMode());
      setKnowledgeAgentId(getSanSuoKnowledgeAgentId());
    };
    update();
    window.addEventListener(SANSUO_MODE_EVENT, update);
    return () => window.removeEventListener(SANSUO_MODE_EVENT, update);
  }, [conversationId]);

  const persist = useCallback(
    async (nextMode: SanSuoMode, nextAgentId: string, clearMaterials = false) => {
      setSanSuoSelection(nextMode, nextAgentId, clearMaterials ? [] : undefined, conversationId);
      try {
        await request.put(`${apiBaseUrl()}/api/sansuo-ui/preferences`, {
          answerMode: nextMode,
          knowledgeAgentId: nextAgentId || null,
        });
      } catch {
        showToast({ message: '选择已在本机保存，但账号偏好保存失败。', status: 'error' });
      }
    },
    [conversationId, showToast],
  );

  const selectMode = (nextMode: SanSuoMode) => {
    if (disabled || nextMode === mode) return;
    if ((nextMode === 'fast' || nextMode === 'knowledge') && files.size > 0) {
      showToast({
        message:
          nextMode === 'knowledge'
            ? '知识库模式不支持聊天附件，请先移除附件。'
            : '快速模式仅支持文字问答。',
        status: 'warning',
      });
      return;
    }
    if (nextMode === 'knowledge' && agents.length === 0) {
      showToast({ message: '暂时没有可用的知识库。', status: 'error' });
      return;
    }
    const nextAgentId =
      nextMode === 'knowledge'
        ? knowledgeAgentId ||
          agents.find((agent) => agent.isDefault)?.agentId ||
          agents[0]?.agentId ||
          ''
        : knowledgeAgentId;
    void persist(nextMode, nextAgentId, nextMode === 'knowledge');
  };

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border-light px-3 py-2">
      <div
        className="inline-flex h-8 shrink-0 items-center rounded-lg bg-surface-secondary-alt p-0.5"
        role="radiogroup"
        aria-label="回答模式"
      >
        {modes.map(({ value, label, Icon, description }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            title={description}
            disabled={disabled}
            onClick={() => selectMode(value)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm transition-all duration-200 disabled:opacity-50',
              mode === value
                ? 'bg-surface-primary text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {mode === 'knowledge' && (
        <Root open={open} onOpenChange={setOpen}>
          <Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="flex h-8 min-w-0 max-w-64 items-center gap-2 rounded-lg border border-border-light bg-surface-primary px-3 text-sm font-medium shadow-sm hover:bg-surface-hover disabled:opacity-50"
            >
              <span className="truncate">{summary}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
          </Trigger>
          <Portal>
            <Content
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              className="z-[100] w-[min(22rem,calc(100vw-24px))] rounded-lg border border-border-light bg-surface-primary p-2 text-text-primary shadow-lg outline-none"
            >
              {agents.map((agent) => {
                const selected = knowledgeAgentId === agent.agentId;
                return (
                  <button
                    key={agent.agentId}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover"
                    onClick={() => {
                      void persist('knowledge', agent.agentId, true);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 truncate">{agent.name}</span>
                    {selected && <Check className="h-4 w-4" />}
                  </button>
                );
              })}
            </Content>
          </Portal>
        </Root>
      )}
    </div>
  );
}
