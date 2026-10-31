import { useMemo, useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { matchSorter } from 'match-sorter';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { Button, Spinner, FilterInput, TooltipAnchor, OGDialogTrigger } from '@librechat/client';
import type { TUserMemory } from 'librechat-data-provider';
import { useMemoriesQuery } from '~/data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import MemoryCreateDialog from './MemoryCreateDialog';
import MemoryUsageBadge from './MemoryUsageBadge';
import MemoryList from './MemoryList';

const pageSize = 10;

export default function MemoryPanel() {
  const localize = useLocalize();
  const { data: memData, isLoading } = useMemoriesQuery();
  const [pageIndex, setPageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const hasReadAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.READ,
  });

  const hasUpdateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.UPDATE,
  });

  const hasCreateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.CREATE,
  });

  const memories: TUserMemory[] = useMemo(() => memData?.memories ?? [], [memData]);

  const filteredMemories = useMemo(() => {
    return matchSorter(memories, searchQuery, {
      keys: ['key', 'value'],
    });
  }, [memories, searchQuery]);

  const currentRows = useMemo(() => {
    return filteredMemories.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  }, [filteredMemories, pageIndex]);

  // Reset page when search changes
  useEffect(() => {
    setPageIndex(0);
  }, [searchQuery]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <Spinner />
      </div>
    );
  }

  if (!hasReadAccess) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-text-secondary">{localize('com_ui_no_read_access')}</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(filteredMemories.length / pageSize);

  return (
    <div className="flex h-auto w-full flex-col px-3 pb-3 pt-2">
      <div role="region" aria-label={localize('com_ui_memories')} className="space-y-2">
        {/* Header: Filter + Create Button */}
        <div className="flex items-center gap-2">
          <FilterInput
            inputId="memory-search"
            label={localize('com_ui_memories_filter')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            containerClassName="flex-1"
          />
          {hasCreateAccess && (
            <MemoryCreateDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <OGDialogTrigger asChild>
                <TooltipAnchor
                  description={localize('com_ui_create_memory')}
                  side="bottom"
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 bg-transparent"
                      aria-label={localize('com_ui_create_memory')}
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                    </Button>
                  }
                />
              </OGDialogTrigger>
            </MemoryCreateDialog>
          )}
        </div>

        {/* Controls: Usage Badge */}
        {memData?.tokenLimit != null && (
          <div className="flex items-center justify-between">
            {/* Usage Badge */}
            {memData?.tokenLimit != null && (
              <MemoryUsageBadge
                percentage={memData.usagePercentage ?? 0}
                tokenLimit={memData.tokenLimit}
                totalTokens={memData.totalTokens}
              />
            )}
          </div>
        )}

        {/* Memory List */}
        <MemoryList
          memories={currentRows}
          hasUpdateAccess={hasUpdateAccess}
          isFiltered={searchQuery.length > 0}
        />

        {/* Footer: Pagination */}
        {filteredMemories.length > pageSize && (
          <div className="flex items-center justify-between gap-2">
            {/* Pagination - Right */}
            {filteredMemories.length > pageSize && (
              <div className="flex items-center gap-2" role="navigation" aria-label="Pagination">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                  disabled={pageIndex === 0}
                  aria-label={localize('com_ui_prev')}
                >
                  {localize('com_ui_prev')}
                </Button>
                <div className="whitespace-nowrap text-sm" aria-live="polite">
                  {pageIndex + 1} / {totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPageIndex((prev) => (prev + 1 < totalPages ? prev + 1 : prev))}
                  disabled={pageIndex + 1 >= totalPages}
                  aria-label={localize('com_ui_next')}
                >
                  {localize('com_ui_next')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
