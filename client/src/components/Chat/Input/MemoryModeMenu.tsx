import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Content, Portal, Root, Trigger } from '@radix-ui/react-popover';
import { useGetUserQuery, useUpdateMemoryPreferencesMutation } from '~/data-provider';
import { MemoryPanel } from '~/components/SidePanel/Memories';

export default function MemoryModeMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const { data: user } = useGetUserQuery();
  const updatePreferences = useUpdateMemoryPreferencesMutation();
  const personalization = user?.personalization as
    | (NonNullable<typeof user>['personalization'] & { memoryMode?: 'manual' | 'off' })
    | undefined;
  const memoryMode =
    personalization?.memoryMode === 'off' || personalization?.memories === false ? 'off' : 'manual';

  return (
    <>
      <Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Trigger asChild>
          <button
            type="button"
            aria-label="选择记忆模式"
            className="h-9 shrink-0 rounded-lg border border-border-light bg-surface-primary px-3 text-sm font-medium text-text-primary shadow-sm transition hover:bg-surface-hover"
          >
            {memoryMode === 'manual' ? '记忆模式' : '无记忆模式'}
          </button>
        </Trigger>
        <Portal>
          <Content
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            role="menu"
            aria-label="选择记忆模式"
            className="z-[100] min-w-44 rounded-lg border border-border-light bg-surface-primary p-1.5 text-text-primary shadow-lg outline-none"
          >
            <div className="px-2 py-1.5 text-xs text-text-secondary">选择记忆模式</div>
            {(['manual', 'off'] as const).map((mode) => (
              <div
                key={mode}
                className="group/option flex w-full items-center rounded-lg text-sm hover:bg-surface-hover"
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={memoryMode === mode}
                  className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-2 py-2 text-left text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
                  onClick={() => {
                    updatePreferences.mutate({ memories: mode === 'manual', memoryMode: mode });
                    setMenuOpen(false);
                  }}
                >
                  <span>{mode === 'manual' ? '记忆模式' : '无记忆模式'}</span>
                  {memoryMode === mode && (
                    <span className="ml-3 text-xs text-text-secondary">当前</span>
                  )}
                </button>
                {mode === 'manual' && (
                  <button
                    type="button"
                    aria-label="编辑记忆"
                    title="编辑记忆"
                    className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-secondary opacity-0 outline-none transition hover:bg-surface-primary hover:text-text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-border-heavy group-hover/option:opacity-100"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditorOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </Content>
        </Portal>
      </Root>
      {editorOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm">
          <button
            type="button"
            aria-label="关闭记忆"
            className="absolute inset-0 h-full w-full"
            onClick={() => setEditorOpen(false)}
          />
          <section className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-primary">
            <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
              <h2 className="text-lg font-semibold text-text-primary">记忆</h2>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover"
                onClick={() => setEditorOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto p-2">
              <MemoryPanel />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
