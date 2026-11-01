#!/usr/bin/env python3
"""Render PDF pages and extract lightweight page text for the PDF vision fallback."""

import argparse
import json
import math
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--dpi', type=int, default=180)
    parser.add_argument('--layout', action='store_true')
    parser.add_argument('--metadata-only', action='store_true')
    parser.add_argument('--text-only', action='store_true')
    parser.add_argument('--region', default='', help='Normalized displayed-page x0,y0,x1,y1')
    parser.add_argument('--max-pixels', type=int, default=8000000)
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
    region = [float(x) for x in args.region.split(',')] if args.region else None
    if region and (len(region) != 4 or not all(math.isfinite(x) and 0 <= x <= 1 for x in region)
                   or region[0] >= region[2] or region[1] >= region[3]):
        raise ValueError('Invalid normalized region')
    max_pixels = max(10000, min(args.max_pixels, 40000000))
    document = fitz.open(args.input)
    document_page_count = document.page_count
    try:
        if args.metadata_only:
            print(json.dumps({'document_page_count': document_page_count, 'pages': []}))
            return
        requested_pages = []
        if args.pages:
            for value in args.pages.split(','):
                try:
                    page_number = int(value.strip())
                except ValueError:
                    continue
                if 1 <= page_number <= document.page_count and page_number not in requested_pages:
                    requested_pages.append(page_number)
        if args.pages and not requested_pages:
            raise ValueError('No requested PDF pages are valid')
        page_numbers = requested_pages if args.pages else range(1, document.page_count + 1)
        for page_number in page_numbers:
            page = document.load_page(page_number - 1)
            pixmap = None
            image_name = None
            render_scale = scale
            clip = page.rect
            if region:
                clip = fitz.Rect(page.rect.x0 + region[0] * page.rect.width,
                                 page.rect.y0 + region[1] * page.rect.height,
                                 page.rect.x0 + region[2] * page.rect.width,
                                 page.rect.y0 + region[3] * page.rect.height)
            if not args.text_only:
                render_scale = min(scale, math.sqrt(max_pixels / (clip.width * clip.height)) * 0.999)
                pixmap = page.get_pixmap(matrix=fitz.Matrix(render_scale, render_scale), clip=clip, alpha=False)
                image_name = f'page_{page_number:04d}.png'
                pixmap.save(str(output_dir / image_name))
            text = (page.get_text('text', sort=True) or '').strip()
            layout_blocks = []
            for block in (page.get_text('dict', sort=True).get('blocks', []) if args.layout else []):
                if block.get('type') != 0:
                    continue
                lines = []
                for line in block.get('lines', []):
                    spans = [{'text': span.get('text', ''), 'bbox': list(span['bbox'])}
                             for span in line.get('spans', []) if span.get('text')]
                    if spans:
                        lines.append({'bbox': list(line['bbox']), 'spans': spans})
                if lines:
                    layout_blocks.append({'bbox': list(block['bbox']), 'lines': lines})
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
                'layout_blocks': layout_blocks,
                'page_rect': list(page.rect),
                'image_name': image_name,
                'width': pixmap.width if pixmap else None,
                'height': pixmap.height if pixmap else None,
                'dpi': round(render_scale * 72, 3),
                'requested_dpi': int(args.dpi),
                'resolution_limited': render_scale < scale,
                'region': region,
                'coordinate_system': 'normalized_displayed_page',
                'renderer_version': 'fitz-bounded-region-v2',
                'status': 'text_only' if args.text_only else 'ready',
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
