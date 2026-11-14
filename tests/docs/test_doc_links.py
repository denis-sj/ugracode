import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("check_doc_links", ROOT / "scripts" / "check_doc_links.py")
cdl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cdl)


class RepoDocsTest(unittest.TestCase):
    def test_repository_docs_have_no_broken_links(self):
        problems = cdl.check(ROOT)
        self.assertEqual(problems, [], "\n".join(problems))


class CheckerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "docs" / "map").mkdir(parents=True)
        (self.root / "docs" / "exists.md").write_text("ok", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel, text):
        p = self.root / rel
        p.write_text(text, encoding="utf-8")
        return p

    def test_existing_link_passes(self):
        self.write("AGENTS.md", "[x](docs/exists.md)")
        self.assertEqual(cdl.check(self.root), [])

    def test_missing_link_fails(self):
        self.write("AGENTS.md", "[x](docs/nope.md)")
        self.assertEqual(len(cdl.check(self.root)), 1)

    def test_link_inside_code_block_ignored(self):
        self.write("AGENTS.md", "```\n[x](docs/nope.md)\n```\n")
        self.assertEqual(cdl.check(self.root), [])

    def test_urls_and_anchors_ignored(self):
        self.write("AGENTS.md", "[a](https://example.com) [b](#top) [c](docs/exists.md#sec)")
        self.assertEqual(cdl.check(self.root), [])

    def test_map_missing_backtick_path_fails(self):
        self.write("docs/map/README.md", "see `docs/missing.md`")
        self.assertEqual(len(cdl.check(self.root)), 1)

    def test_map_existing_backtick_path_passes(self):
        self.write("docs/map/README.md", "see `docs/exists.md` and `docs/map/features/<f>.md`")
        self.assertEqual(cdl.check(self.root), [])

    def test_backtick_path_outside_map_not_checked(self):
        self.write("docs/other.md", "see `docs/missing.md`")
        self.assertEqual(cdl.check(self.root), [])

    def test_main_returns_nonzero_on_problems(self):
        self.write("AGENTS.md", "[x](docs/nope.md)")
        self.assertEqual(cdl.main(["prog", str(self.root)]), 1)

    def test_main_returns_zero_when_clean(self):
        self.write("AGENTS.md", "[x](docs/exists.md)")
        self.assertEqual(cdl.main(["prog", str(self.root)]), 0)


if __name__ == "__main__":
    unittest.main()
