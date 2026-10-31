import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type TPagesProps = {
  pages: number;
  pageNumber: number;
  setPageNumber: (pageNumber: number) => void;
  nextPage: () => Promise<void>;
  previousPage: () => Promise<void>;
};

export default function Pages({
  pageNumber,
  pages,
  nextPage,
  previousPage,
  setPageNumber,
}: TPagesProps) {
  const clickHandler =
    (func: () => Promise<void>) => async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      await func();
    };

  if (pageNumber > pages) {
    setPageNumber(pages);
  }

  return pageNumber == 1 && pages == 1 ? null : (
    <div className="m-auto mb-2 mt-4 flex items-center justify-center gap-2">
      <button
        onClick={clickHandler(previousPage)}
        aria-label="上一页"
        className={
          'btn btn-small bg-transition m-auto flex size-8 items-center justify-center p-0 transition hover:bg-black/[0.06] disabled:text-gray-300 dark:text-white dark:hover:bg-white/[0.08] dark:disabled:text-gray-500' +
          (pageNumber <= 1 ? ' hidden-visibility' : '')
        }
        disabled={pageNumber <= 1}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      <span className="min-w-16 flex-none text-center text-gray-500 [font-variant-numeric:tabular-nums] dark:text-gray-400">
        {pageNumber} / {pages}
      </span>
      <button
        onClick={clickHandler(nextPage)}
        aria-label="下一页"
        className={
          'btn btn-small bg-transition m-auto flex size-8 items-center justify-center p-0 transition hover:bg-black/[0.06] disabled:text-gray-300 dark:text-white dark:hover:bg-white/[0.08] dark:disabled:text-gray-500' +
          (pageNumber >= pages ? ' hidden-visibility' : '')
        }
        disabled={pageNumber >= pages}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
