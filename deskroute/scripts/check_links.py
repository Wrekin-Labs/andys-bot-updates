from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit,unquote
import xml.etree.ElementTree as ET
base=Path(__file__).resolve().parents[1]/'control-panel'
errors=[];count=0
class Links(HTMLParser):
 def __init__(self): super().__init__();self.links=[];self.ids=set()
 def handle_starttag(self,tag,attrs):
  d=dict(attrs)
  if 'id' in d:self.ids.add(d['id'])
  for key in ('href','src'):
   if key in d:self.links.append(d[key])
for page in base.rglob('*.html'):
 parser=Links();parser.feed(page.read_text());count+=1
 for link in parser.links:
  u=urlsplit(link)
  if u.scheme or u.netloc:continue
  target=(page.parent/unquote(u.path)).resolve() if u.path else page
  if target.is_dir():target=target/'index.html'
  if not target.exists():errors.append(f'{page.relative_to(base)}: missing {link}');continue
  if u.fragment and target.suffix=='.html' and not (page.name=='index.html' and not u.path):
   target_parser=Links();target_parser.feed(target.read_text())
   if u.fragment not in target_parser.ids:errors.append(f'{page.relative_to(base)}: missing anchor {link}')
for asset in (base/'assets').glob('*.svg'):
 try:
  if ET.parse(asset).getroot().tag != '{http://www.w3.org/2000/svg}svg':
   errors.append(f'{asset.name}: not an SVG image')
 except ET.ParseError:
  errors.append(f'{asset.name}: invalid SVG')
for asset in (base/'assets').glob('*.woff2'):
 if asset.read_bytes()[:4] != b'wOF2':errors.append(f'{asset.name}: invalid font')
if errors:raise SystemExit('\n'.join(errors))
print(f'PASS: local links and assets in {count} HTML pages')
