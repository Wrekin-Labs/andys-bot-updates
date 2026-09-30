#!/usr/bin/env python3
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import shutil
import sys

HERE = Path(__file__).resolve().parent
PLUGIN = HERE / "plugin"
MANIFEST = json.loads((PLUGIN / "plugin.json").read_text(encoding="utf-8"))
VERSION = MANIFEST["version"]
OUTDIR = HERE / "dist"
OUTDIR.mkdir(exist_ok=True)
OUT = OUTDIR / f"keepgoing-plugin-{VERSION}.zip"

if OUT.exists():
    OUT.unlink()

files = sorted(p for p in PLUGIN.rglob("*") if p.is_file())
if not files:
    raise SystemExit("plugin package is empty")

with ZipFile(OUT, "w", ZIP_DEFLATED) as z:
    for file in files:
        rel = file.relative_to(PLUGIN)
        z.write(file, rel.as_posix())

print(str(OUT))
print(f"{len(files)} files, {OUT.stat().st_size} bytes")
