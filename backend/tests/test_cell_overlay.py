import gzip
import struct
from unittest import TestCase

from app.cell_overlay import packed_cells, tile_page


class CellOverlayTest(TestCase):
    def test_binary_overlay_preserves_coordinates_and_classes_beyond_first_page(self):
        dense = [(5.125, 6.375, 1)] * 6100
        far = [(24501.75, 20491.25, 2)] * 31
        packed = packed_cells({(0, 0): dense, (11, 10): far}, tuple)
        result = list(struct.iter_unpack("<ddd", gzip.decompress(packed)))
        self.assertEqual(result, dense + far)

    def test_detail_pages_keep_every_accepted_point_when_rows_are_filtered(self):
        records = list(range(12_011))
        def point_for(index):
            return (index, 0, 1) if index % 2 == 0 else None

        first = tile_page(records, 0, point_for)
        second = tile_page(records, first["next_offset"], point_for)
        self.assertEqual(len(first["points"]), 5000)
        self.assertIsNone(second["next_offset"])
        self.assertEqual(first["points"] + second["points"], [point_for(index) for index in range(0, len(records), 2)])
