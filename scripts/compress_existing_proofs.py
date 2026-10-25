"""Compress proof JPEGs without changing their URLs; preserve an original ZIP first."""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import datetime, hashlib, io, json, zipfile

ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / 'data/proofs'
OUT = ROOT / '.local/proof-compression'
LIMIT = 150 * 1024

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(PHOTOS.glob('*.jpg'))
    report_path = OUT / 'report.json'
    if report_path.exists():
        previous = json.loads(report_path.read_text(encoding='utf-8'))
        if len(files) == previous['files'] and all(
            (PHOTOS / r['file']).exists() and hashlib.sha256((PHOTOS / r['file']).read_bytes()).hexdigest() == r['sha256']
            for r in previous['rows']
        ):
            print(json.dumps({**{k: v for k, v in previous.items() if k != 'rows'}, 'alreadyCompressed': True}))
            return
        raise RuntimeError('Existing compression report differs; review it before starting another lossy pass.')
    stamp = datetime.datetime.now().strftime('%y%m%d_%H%M%S')
    backup = OUT / f'proofs_backup_{stamp}.zip'
    with zipfile.ZipFile(backup, 'x', zipfile.ZIP_DEFLATED) as z:
        for path in files:
            z.write(path, 'proofs/' + path.name)
    rows = []
    for path in files:
        original = path.read_bytes()
        with Image.open(io.BytesIO(original)) as src:
            image = ImageOps.exif_transpose(src).convert('RGB')
        # Keep lettering resolution; reduce JPEG quality before resizing pixels.
        size = image.size
        candidate = None
        for attempt in range(12):
            work = image if image.size == size else image.resize(size, Image.Resampling.LANCZOS)
            for quality in (82, 78, 74, 70, 66, 62, 58, 54, 50, 46, 42):
                stream = io.BytesIO()
                work.save(stream, 'JPEG', quality=quality, optimize=True, progressive=True)
                candidate = stream.getvalue()
                if len(candidate) <= LIMIT:
                    break
            if len(candidate) <= LIMIT:
                break
            size = tuple(max(1, round(n * .9)) for n in size)
        if len(candidate) > LIMIT:
            raise RuntimeError('Cannot fit photo within 150 KiB: ' + path.name)
        if len(original) <= len(candidate) and len(original) <= LIMIT:
            candidate, size, quality = original, image.size, None
        with Image.open(io.BytesIO(candidate)) as check:
            check.verify()
        path.write_bytes(candidate)
        rows.append(dict(file=path.name, before=len(original), after=len(candidate),
                         dimensions=list(image.size), outputDimensions=list(size), quality=quality,
                         originalSha256=hashlib.sha256(original).hexdigest(), sha256=hashlib.sha256(candidate).hexdigest()))
    # Compare the largest originals with their compressed counterparts.
    selected = sorted(rows, key=lambda r: r['before'], reverse=True)[:6]
    sheet = Image.new('RGB', (1200, 6 * 420), 'white')
    draw = ImageDraw.Draw(sheet)
    with zipfile.ZipFile(backup) as z:
        for i, row in enumerate(selected):
            for j, data in enumerate((z.read('proofs/' + row['file']), (PHOTOS / row['file']).read_bytes())):
                im = Image.open(io.BytesIO(data)).convert('RGB')
                im.thumbnail((590, 385))
                sheet.paste(im, (j * 600, i * 420 + 30))
                draw.text((j * 600 + 5, i * 420 + 5), f"{'BEFORE' if j == 0 else 'AFTER'} {len(data):,} bytes", fill='black')
    sheet.save(OUT / 'comparison.jpg', quality=92)
    report = dict(files=len(rows), changed=sum(r['before'] != r['after'] for r in rows),
                  before=sum(r['before'] for r in rows), after=sum(r['after'] for r in rows),
                  maxBytes=max(r['after'] for r in rows), resized=sum(r['dimensions'] != r['outputDimensions'] for r in rows),
                  backup=str(backup), rows=rows)
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'rows'}))

if __name__ == '__main__':
    main()
