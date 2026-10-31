"""Synthetic native/table/scan PDF for bounded parser acceptance; no user data."""
import fitz
import sys
from pathlib import Path
out = Path(sys.argv[1]); out.parent.mkdir(parents=True, exist_ok=True)
doc = fitz.open()
p = doc.new_page()
p.insert_text((50, 55), 'JIT synthetic equipment specification')
p.insert_text((50, 85), 'GB/T 12345-2024; ZX-800; clause 3.2: bearing temperature limit 80 C.')
p.insert_text((50, 115), 'Service interval is 3 months. These are synthetic acceptance values.')
p = doc.new_page()
p.insert_text((50, 55), 'Synthetic inspection schedule')
rows = [['Item', 'Limit', 'Unit'], ['Bearing', '80', 'C'], ['Pressure', '1.6', 'MPa'], ['Interval', '3', 'months']]
for x in [50, 210, 370, 530]: p.draw_line((x, 100), (x, 260))
for y in [100, 140, 180, 220, 260]: p.draw_line((50, y), (530, y))
for r, row in enumerate(rows):
    for c, text in enumerate(row): p.insert_text((60+c*160, 125+r*40), text)
scan = fitz.open(); sp = scan.new_page()
sp.insert_text((50, 65), 'SCANNED SAFETY DIAGRAM', fontsize=20)
sp.insert_text((50, 110), 'Emergency shutoff valve: RED, tag SV-42', fontsize=16)
sp.draw_rect(fitz.Rect(100, 160, 350, 300), color=(1,0,0), fill=(1,0.8,0.8))
sp.insert_text((150, 230), 'SV-42', fontsize=28)
image = sp.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).tobytes('png')
p = doc.new_page(); p.insert_image(p.rect, stream=image)
doc.save(out)
print(str(out))
