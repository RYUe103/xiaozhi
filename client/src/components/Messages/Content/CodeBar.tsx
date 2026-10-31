import React from 'react';
import { InfoIcon, WrapText } from 'lucide-react';
import type { CodeBarProps } from '~/common';
import useCopyCode from '~/components/Messages/Content/useCopyCode';
import CopyButton from '~/components/Messages/Content/CopyButton';
import RunCode from '~/components/Messages/Content/RunCode';
import { useLocalize } from '~/hooks';

const CodeBar: React.FC<CodeBarProps & { wrapCode?: boolean; onToggleWrap?: () => void }> =
  React.memo(
    ({
      lang,
      error,
      codeRef,
      blockIndex,
      plugin = null,
      allowExecution = true,
      wrapCode,
      onToggleWrap,
    }) => {
      const localize = useLocalize();
      const { isCopied, handleCopy } = useCopyCode(codeRef);

      return (
        <div className="sansuo-code-toolbar flex items-center justify-between font-sans text-xs text-text-secondary">
          <span className="flex items-center gap-1.5 text-xs font-medium">{lang}</span>
          {plugin === true ? (
            <InfoIcon className="ml-auto flex h-4 w-4 gap-2 text-text-secondary" />
          ) : (
            <div className="flex items-center justify-center gap-2">
              {onToggleWrap && (
                <button
                  type="button"
                  onClick={onToggleWrap}
                  aria-label="自动换行"
                  title="自动换行"
                  aria-pressed={wrapCode}
                  className="rounded-md p-1.5 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
                >
                  <WrapText className="h-4 w-4" />
                </button>
              )}
              {allowExecution === true && (
                <RunCode lang={lang} codeRef={codeRef} blockIndex={blockIndex} />
              )}
              {error !== true && (
                <CopyButton
                  isCopied={isCopied}
                  onClick={handleCopy}
                  label={localize('com_ui_copy_code')}
                />
              )}
            </div>
          )}
        </div>
      );
    },
  );

export default CodeBar;
