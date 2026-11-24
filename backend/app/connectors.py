"""Replaceable inbound EMR/LIS adapter contract. The supplied adapter is a mock."""

import asyncio
from typing import Protocol


class AdapterUnavailable(Exception):
    pass


class Adapter(Protocol):
    async def probe(self) -> None: ...
    async def receive(self, message: dict) -> dict: ...
    async def lookup_patient(self, snapshot: dict | None) -> dict | None: ...


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


ADAPTERS = {"mock": MockAdapter}
TIMEOUT_SECONDS = 0.8


async def invoke(connection, operation, *arguments):
    adapter = ADAPTERS[connection.mode](connection.scenario)
    return await asyncio.wait_for(getattr(adapter, operation)(*arguments), timeout=TIMEOUT_SECONDS)
