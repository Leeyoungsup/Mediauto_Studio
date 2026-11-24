from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from app.intake import FilenameRule, classify, compile_rule, scan_files


def example_rule() -> FilenameRule:
    return FilenameRule(
        name="Example",
        pattern="LAB-{case}-{stain}-{slide}",
        case_id="{case}",
        slide_id="{stain}-{slide}",
        stain="{stain}",
    )


class IntakeTest(TestCase):
    def test_duplicate_slide_labels_keep_distinct_source_ids(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            for filename in ("LAB-001-HE-02.ndpi", "LAB-001-HE-02.svs", "different.svs", "notes.txt"):
                (root / filename).write_bytes(b"test")
            (root / "linked.svs").symlink_to(root / "LAB-001-HE-02.svs")
            files = scan_files(root)
            rule = example_rule()
            rules = [(rule, compile_rule(rule))]
            matches = [classify(file, rules) for file in files]
            self.assertEqual(len(files), 3)
            self.assertEqual(len({file.id for file in files}), 3)
            self.assertEqual(matches[0], matches[1])
            self.assertEqual(matches[0]["fields"]["case_id"], "001")
            self.assertEqual(matches[0]["fields"]["patient_number"], "")
            self.assertIsNone(matches[2])

    def test_rule_requires_delimited_tokens_and_known_output_fields(self):
        rule = example_rule()
        for change in ({"pattern": "LAB-{case}{slide}"}, {"case_id": "{unknown}"}, {"slide_id": "{slide!r}"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                compile_rule(rule.model_copy(update=change))
