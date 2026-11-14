"""Check documentation links and paths.

Fails when:
- a markdown link [text](path) in AGENTS.md or docs/**/*.md points to a missing file;
- a backticked repo path in docs/map/**/*.md does not exist.

URLs, anchors and fenced code blocks are ignored.

Usage: python3 scripts/check_doc_links.py [repo_root]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

LINK_RE = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
BACKTICK_RE = re.compile(r"`([^`\s]+)`")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
PATH_PREFIXES = ("docs/", "scripts/", "tests/", ".github/", "src/", "apps/", "backend/", "frontend/")


def strip_fenced_blocks(text: str) -> str:
    """Return text with fenced code blocks replaced by empty lines (line numbers kept)."""
    out: list[str] = []
    inside = False
    for line in text.splitlines():
        if FENCE_RE.match(line):
            inside = not inside
            out.append("")
            continue
        out.append("" if inside else line)
    return "\n".join(out)


def is_external(target: str) -> bool:
    return target.startswith(("http://", "https://", "mailto:", "tel:", "#"))


def find_broken_links(md_file: Path) -> list[str]:
    """Return broken relative markdown links in md_file."""
    text = strip_fenced_blocks(md_file.read_text(encoding="utf-8"))
    broken: list[str] = []
    for target in LINK_RE.findall(text):
        if is_external(target):
            continue
        path_part = target.split("#", 1)[0]
        if not path_part:
            continue
        if not (md_file.parent / path_part).exists():
            broken.append(f"{md_file}: broken link -> {target}")
    return broken


def find_missing_map_paths(md_file: Path, root: Path) -> list[str]:
    """Return backticked repo paths in md_file that do not exist under root."""
    text = strip_fenced_blocks(md_file.read_text(encoding="utf-8"))
    missing: list[str] = []
    for candidate in BACKTICK_RE.findall(text):
        if candidate in ("AGENTS.md", "CLAUDE.md", "README.md") or candidate.startswith(PATH_PREFIXES):
            if any(ch in candidate for ch in "<>*"):
                continue  # template like docs/map/features/<feature>.md
            if not (root / candidate.rstrip("/")).exists():
                missing.append(f"{md_file}: missing path -> {candidate}")
    return missing


def collect_markdown(root: Path) -> list[Path]:
    files = [root / "AGENTS.md"] if (root / "AGENTS.md").exists() else []
    docs = root / "docs"
    if docs.exists():
        files.extend(sorted(docs.rglob("*.md")))
    return files


def check(root: Path) -> list[str]:
    problems: list[str] = []
    map_dir = root / "docs" / "map"
    for md in collect_markdown(root):
        problems.extend(find_broken_links(md))
        if map_dir in md.parents:
            problems.extend(find_missing_map_paths(md, root))
    return problems


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent
    problems = check(root)
    for p in problems:
        print(p)
    if problems:
        print(f"\n{len(problems)} problem(s) found")
        return 1
    print("docs OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
