const fs = require('fs');
const path = require('path');

const value = (flag) => process.argv[process.argv.indexOf(flag) + 1];
const outputDir = value('--output-dir');
const requested = process.argv.includes('--pages')
  ? value('--pages')
      .split(',')
      .map(Number)
      .filter((page) => Number.isInteger(page) && page > 0)
  : [];
fs.mkdirSync(outputDir, { recursive: true });
const pages = (requested.length ? requested : [1, 2]).map((page) => {
  const imageName = `page_${String(page).padStart(4, '0')}.png`;
  fs.writeFileSync(path.join(outputDir, imageName), Buffer.from(`png-page-${page}`));
  const text = page === 1 ? '第一页测试文字' : '';
  return {
    page,
    text,
    text_chars: text.length,
    image_name: imageName,
    width: 1200,
    height: 1600,
    dpi: Number(value('--dpi')),
    status: 'ready',
  };
});
const result = JSON.stringify({ document_page_count: 30, rendered_page_count: pages.length, pages,
  ...(process.env.SANSUO_TEST_LARGE_LAYOUT ? { diagnosticPadding: 'x'.repeat(2 * 1024 * 1024) } : {}),
});
if (process.argv.includes('--result-json')) fs.writeFileSync(value('--result-json'), result);
else process.stdout.write(result);
