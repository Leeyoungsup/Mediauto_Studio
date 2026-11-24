import asyncio
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase

from app.connectors import invoke
from app.report_delivery import ack_result


class ReportDeliveryTest(IsolatedAsyncioTestCase):
    async def test_mock_timeout_rejection_and_stable_ack(self):
        message = {"message_id": "synthetic-delivery", "digest": "synthetic-digest", "document": {}}
        with self.assertRaises(asyncio.TimeoutError):
            await invoke(SimpleNamespace(mode="mock", scenario="timeout"), "send_report", message)
        normal = SimpleNamespace(mode="mock", scenario="normal")
        first = await invoke(normal, "send_report", message)
        self.assertEqual(first, await invoke(normal, "send_report", message))
        self.assertEqual(ack_result(message, first), (first["ack_id"], None))
        self.assertEqual(ack_result(message, {**first, "message_id": "wrong"}), (None, "invalid_ack"))
        self.assertEqual(ack_result(message, {}), (None, "invalid_ack"))
        rejected = await invoke(SimpleNamespace(mode="mock", scenario="reject_report"), "send_report", message)
        self.assertEqual(ack_result(message, rejected), (rejected["ack_id"], "rejected"))
