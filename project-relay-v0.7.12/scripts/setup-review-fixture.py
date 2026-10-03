from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def fixture_root() -> Path:
    return Path.home() / "ProjectRelayReviewFixture"


def create_fixture() -> Path:
    root = fixture_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / "sample.txt").write_text(
        "Project Relay reviewer fixture\nrelay search target\nThis file is disposable.\n",
        encoding="utf-8",
    )
    (root / "sample.csv").write_text(
        "name,value\nrelay,76\nreview,1\n",
        encoding="utf-8",
    )
    (root / "sample.json").write_text(
        json.dumps({"project": "Project Relay", "fixture": True, "version": "0.7.6"}, indent=2) + "\n",
        encoding="utf-8",
    )
    (root / "README.txt").write_text(
        "Disposable Project Relay reviewer fixture.\n"
        "Safe tests: file info/list/read/search, exact approval-gated write, owner document creation, ZIP, and rollback.\n"
        "Delete this whole folder after review.\n",
        encoding="utf-8",
    )
    return root


def remove_fixture() -> None:
    root = fixture_root()
    if root.exists():
        shutil.rmtree(root)


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or remove disposable Project Relay reviewer fixtures.")
    parser.add_argument("--remove", action="store_true", help="Remove only ~/ProjectRelayReviewFixture.")
    args = parser.parse_args()

    if args.remove:
        remove_fixture()
        print(f"Removed {fixture_root()}")
        return 0

    root = create_fixture()
    print(f"Created {root}")
    print("Next: run scripts/reviewer-demo-window.py on the disposable Review-PC.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
