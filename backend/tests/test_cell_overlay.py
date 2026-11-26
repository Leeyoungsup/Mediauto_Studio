from unittest import TestCase

from app.cell_overlay import density_grid, tile_page


class CellOverlayTest(TestCase):
    def test_density_represents_every_cell_and_both_ends_of_the_scan(self):
        dense = [(5, 6, 1)] * 6100
        far = [(24501, 20491, 2)] * 31
        result = density_grid({(0, 0): dense, (11, 10): far}, (30000, 25000), tuple)
        self.assertEqual(sum(bin[-1] for bin in result["bins"]), 6131)
        self.assertEqual({bin[2] for bin in result["bins"]}, {1, 2})
        self.assertGreater(max(bin[0] for bin in result["bins"]), 24000)

    def test_detail_pages_keep_every_accepted_point_when_rows_are_filtered(self):
        records = list(range(12_011))
        def point_for(index):
            return (index, 0, 1) if index % 2 == 0 else None

        first = tile_page(records, 0, point_for)
        second = tile_page(records, first["next_offset"], point_for)
        self.assertEqual(len(first["points"]), 5000)
        self.assertIsNone(second["next_offset"])
        self.assertEqual(first["points"] + second["points"], [point_for(index) for index in range(0, len(records), 2)])
