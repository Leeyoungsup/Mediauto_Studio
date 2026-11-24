from types import SimpleNamespace
from unittest import TestCase
from uuid import uuid4

from app.related_cases import same_patient, stain_kind


class RelatedCasesTest(TestCase):
    def test_patient_equality_uses_internal_identity_and_distinct_cases(self):
        patient = uuid4()
        left = SimpleNamespace(id=uuid4(), patient_id=patient, patient_name="Synthetic")
        right = SimpleNamespace(id=uuid4(), patient_id=patient)
        self.assertTrue(same_patient(left, right))
        self.assertFalse(same_patient(left, left))
        self.assertFalse(same_patient(left, SimpleNamespace(id=right.id, patient_id=uuid4(), patient_name="Synthetic")))
        left.patient_id = right.patient_id = None
        self.assertFalse(same_patient(left, right))

    def test_stain_classification_does_not_equate_other_stains_with_biopsy(self):
        self.assertEqual(stain_kind("Pap Smear"), "pap")
        self.assertEqual(stain_kind("H & E"), "he")
        self.assertIsNone(stain_kind(None))
        self.assertIsNone(stain_kind("PD-L1"))
