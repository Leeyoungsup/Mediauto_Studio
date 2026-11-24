"""Replaceable EMR/LIS adapter contract. The supplied adapter is a mock."""

import asyncio
import hashlib
from typing import Protocol


class AdapterUnavailable(Exception):
    pass


class Adapter(Protocol):
    async def probe(self) -> None: ...
    async def receive(self, message: dict) -> dict: ...
    async def lookup_patient(self, snapshot: dict | None) -> dict | None: ...
    async def send_report(self, message: dict) -> dict: ...


class MockAdapter:
    def __init__(self, scenario):
        self.scenario = scenario

    async def probe(self):
        if self.scenario == "unavailable":
            raise AdapterUnavailable
        if self.scenario == "timeout":
            await asyncio.sleep(30)

    async def receive(self, message):
        await self.probe()
        return message

    async def lookup_patient(self, snapshot):
        await self.probe()
        return snapshot


    async def send_report(self, message):
        await self.probe()
        message_id = message["message_id"]
        checksum = message["digest"]
        ack_id = hashlib.sha256(f"{message_id}:{checksum}".encode()).hexdigest()
        return {
            "message_id": message_id,
            "digest": "invalid" if self.scenario == "bad_ack" else checksum,
            "status": "rejected" if self.scenario == "reject_report" else "accepted",
            "ack_id": f"mock-{ack_id}",
        }


ADAPTERS = {"mock": MockAdapter}
TIMEOUT_SECONDS = 0.8


async def invoke(connection, operation, *arguments):
    adapter = ADAPTERS[connection.mode](connection.scenario)
    return await asyncio.wait_for(getattr(adapter, operation)(*arguments), timeout=TIMEOUT_SECONDS)
