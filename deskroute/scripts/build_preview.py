from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
out = root.parent / 'deskroute-preview-public'
if out.exists():
    shutil.rmtree(out)

shutil.copytree(root / 'control-panel', out)
qa = out / 'qa'
qa.mkdir()

for name in ('index.html', 'app.js', 'styles.css', 'manifest.webmanifest'):
    shutil.copy2(root / 'control-panel' / name, qa / name)

shutil.copytree(root / 'control-panel/assets', qa / 'assets')
shutil.copytree(root / 'control-panel/help', qa / 'help')
shutil.copy2(root / 'tests/fixture-api.js', qa / 'api.js')
shutil.copy2(root / 'tests/widget.html', qa / 'widget.html')
shutil.copy2(root / 'widget/deskroute-widget.js', qa / 'widget.js')
shutil.copy2(root / 'widget/deskroute-widget.js', out / 'deskroute-widget.js')

p = qa / 'app.js'
p.write_text(
    p.read_text(encoding='utf-8').replace(
        "if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});",
        '',
    ),
    encoding='utf-8',
)

p = qa / 'index.html'
s = p.read_text(encoding='utf-8').replace(
    '<head>',
    '<head><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'; style-src \'self\' \'unsafe-inline\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">',
)
s = s.replace('href="./site/', 'href="../site/')
s = s.replace('href="./password.html"', 'href="../password.html"')
s = s.replace(
    '<body>',
    '<body><div style="background:#fff3da;padding:7px 16px;text-align:center;font-size:12px">DEMONSTRATION · Example data · Nothing is sent · Reload to reset</div>',
)
p.write_text(s, encoding='utf-8')

print('Built preview with isolated /qa/ demonstration; no network access from demo.')
