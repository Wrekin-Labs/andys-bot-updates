#!/usr/bin/env python3
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json
import subprocess

HERE = Path(__file__).resolve().parent
PLUGIN = HERE / "plugin"
MANIFEST = json.loads((PLUGIN / "plugin.json").read_text(encoding="utf-8"))
VERSION = MANIFEST["version"]
subprocess.run(["node", str(HERE / "validate_plugin_package.mjs")], check=True)
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
        if file.is_symlink():
            raise SystemExit(f"Symlinks are not allowed in the plugin package: {file.name}")
        rel = file.relative_to(PLUGIN)
        entry = ZipInfo(rel.as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        z.writestr(entry, file.read_bytes(), compresslevel=9)

digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
OUT.with_suffix(".zip.sha256").write_text(f"{digest}  {OUT.name}\n", encoding="utf-8")
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True).strip()
OUT.with_suffix(".provenance.json").write_text(json.dumps({
    "commit": commit, "version": VERSION, "sha256": digest,
    "files": len(files), "artifact": OUT.name
}, indent=2) + "\n", encoding="utf-8")

print(str(OUT))
print(f"{len(files)} files, {OUT.stat().st_size} bytes")
