#!/usr/bin/env python3
"""Render PDF pages and extract lightweight page text for the PDF vision fallback."""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--dpi', type=int, default=180)
    parser.add_argument(
        '--pages',
        default='',
        help='Comma-separated 1-based page numbers. Empty renders every page.',
    )
    args = parser.parse_args()

    try:
        import fitz
    except ImportError as exc:
        raise SystemExit('PyMuPDF is required for PDF vision fallback: pip install PyMuPDF') from exc

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    pages = []
    scale = max(96, min(int(args.dpi), 240)) / 72.0
    document = fitz.open(args.input)
    document_page_count = document.page_count
    try:
        requested_pages = []
        if args.pages:
            for value in args.pages.split(','):
                try:
                    page_number = int(value.strip())
                except ValueError:
                    continue
                if 1 <= page_number <= document.page_count and page_number not in requested_pages:
                    requested_pages.append(page_number)
        page_numbers = requested_pages or range(1, document.page_count + 1)
        for page_number in page_numbers:
            page = document.load_page(page_number - 1)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            image_name = f'page_{page_number:04d}.png'
            pixmap.save(str(output_dir / image_name))
            text = ' '.join((page.get_text('text') or '').split())
            # Native table geometry only. Raster scan recognition remains a separate VL/OCR capability.
            tables = []
            table_status = 'not_detected'
            if text and hasattr(page, 'find_tables'):
                try:
                    detected = page.find_tables()
                    for index, table in enumerate(detected.tables[:100]):
                        if table.row_count * table.col_count > 100000:
                            table_status = 'budget_exceeded'
                            continue
                        rows = table.extract()
                        tables.append({
                            'table_id': f'fitz-page-{page_number}-table-{index + 1}',
                            'page': page_number,
                            'engine': 'fitz',
                            'rows': rows,
                            'bbox': list(table.bbox),
                            'complete': True,
                        })
                    if tables:
                        table_status = 'available'
                except Exception:
                    table_status = 'failed'

            pages.append({
                'page': page_number,
                'text': text,
                'text_chars': len(text),
                'image_name': image_name,
                'width': pixmap.width,
                'height': pixmap.height,
                'dpi': int(args.dpi),
                'status': 'ready',
                'tables': tables,
                'table_status': table_status,
            })
    finally:
        document.close()

    print(json.dumps({
        'document_page_count': document_page_count,
        'rendered_page_count': len(pages),
        'pages': pages,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
