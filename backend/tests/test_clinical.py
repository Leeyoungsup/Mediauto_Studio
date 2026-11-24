import asyncio
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase, skipUnless
from unittest.mock import patch
from uuid import uuid4

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import DBAPIError

from app.auth import hash_password
from app.models import AuthUser
from app.database import database_url
from app.main import app


PASSWORD = "synthetic-test-password"


async def create_account(organization, username, role):
    async with AsyncSession(app.state.engine, expire_on_commit=False) as session, session.begin():
        user = AuthUser(organization=organization, username=username, display_name=username, role=role,
                        password_hash=await asyncio.to_thread(hash_password, PASSWORD, app.state.auth_key))
        session.add(user)
        await session.flush()
        return user


async def login(client, organization, username):
    response = await client.post("/api/auth/login", json={
        "organization": organization, "username": username, "password": PASSWORD,
    })
    assert response.status_code == 200, response.text
    return response


@skipUnless(os.environ.get("MEDIAUTO_CLINICAL_TEST") == "1", "isolated PostgreSQL required")
class ClinicalApiTest(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.assertEqual(database_url().database, "mediauto_clinical_test")
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        folder = directory.name
        self.root = Path(folder)
        override = patch("app.clinical.DATA_ROOT", self.root)
        override.start()
        self.addCleanup(override.stop)
        context = app.router.lifespan_context(app)
        await context.__aenter__()
        self.addAsyncCleanup(context.__aexit__, None, None, None)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 12345)),
            base_url="http://localhost",
        )
        self.addAsyncCleanup(self.client.aclose)
        self.org = "test-" + uuid4().hex
        self.url = "/api/clinical/" + self.org
        self.user = await create_account(self.org, "writer", "admin")
        await login(self.client, self.org, self.user.username)

    async def create(self, category, data, key=None, organization_url=None, expected=201):
        response = await self.client.post(
            f"{organization_url or self.url}/{category}", json=data,
            headers={"Idempotency-Key": key or uuid4().hex},
        )
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    async def test_patient_case_specimen_slide_and_alternate_scans(self):
        case = await self.create("cases", {"case_number": "DEMO-001"})
        self.assertIsNone(case["patient_id"])
        self.assertEqual(case["status"], "registered")
        patient = await self.create("patients", {"display_name": "Synthetic patient"})
        self.assertEqual(patient["source"], "manual")
        linked = await self.client.patch(f"{self.url}/cases/{case['id']}/patient", json={
            "target_id": patient["id"], "version": 1, "reason": "Confirmed by operator",
        })
        self.assertEqual(linked.status_code, 200, linked.text)
        self.assertEqual(linked.json()["patient_id"], patient["id"])
        self.assertEqual(linked.json()["version"], 2)
        specimens = await self.client.get(f"{self.url}/specimens", params={"parent_id": case["id"]})
        self.assertEqual(specimens.json(), [])
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "A1"})
        slide = await self.create("slides", {"slide_number": "S-01", "stain": "H&E"})
        self.assertEqual(slide["status"], "unlinked")
        self.assertEqual((await self.client.get(f"{self.url}/slides?unlinked=true")).json(), [slide])
        for extension in ("ndpi", "svs"):
            path = self.root / f"synthetic.{extension}"
            path.write_bytes(b"synthetic scan location fixture")
            scan = await self.create("scans", {"slide_id": slide["id"], "storage_key": path.name})
            self.assertEqual(scan["format"], extension.upper())
            self.assertEqual(scan["storage_key"], path.name)
            self.assertEqual(scan["status"], "registered")
        link = await self.client.patch(f"{self.url}/slides/{slide['id']}/specimen", json={
            "target_id": specimen["id"], "version": 1, "reason": "Specimen barcode checked",
        })
        self.assertEqual(link.status_code, 200, link.text)
        self.assertEqual(link.json()["status"], "registered")
        self.assertEqual((await self.client.get(f"{self.url}/slides", params={"parent_id": specimen["id"]})).json(), [link.json()])
        scans = (await self.client.get(f"{self.url}/scans", params={"parent_id": slide["id"]})).json()
        self.assertEqual(len(scans), 2)
        await self.create("scans", {"slide_id": slide["id"], "storage_key": "synthetic.svs"}, expected=409)
        history = (await self.client.get(f"{self.url}/slides/{slide['id']}/history")).json()
        self.assertEqual([event["version"] for event in history], [2, 1])
        self.assertEqual(history[0]["before"], {"status": "unlinked", "specimen_id": None})
        self.assertEqual(history[0]["after"]["specimen_id"], specimen["id"])
        self.assertEqual(history[0]["actor"], str(self.user.id))
        self.assertIn("transaction_id", history[0])

    async def test_external_identifiers_are_scoped_and_conflicts_keep_existing_links(self):
        patient = await self.create("patients", {"display_name": "Same Example"})
        other = await self.create("patients", {"display_name": "Same Example"})
        self.assertNotEqual(patient["id"], other["id"])
        identifier = {"system": "emr.example", "kind": "MRN", "value": "SYNTH-103"}
        request = {**identifier, "version": 1, "reason": "Identity confirmed"}
        response = await self.client.post(f"{self.url}/patients/{patient['id']}/external-identifiers", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["identifier"]["last_synced_at"], None)
        found = await self.client.post(f"{self.url}/patients/external-identifiers/lookup", json=identifier)
        self.assertEqual(found.json()["record_id"], patient["id"])
        conflict = await self.client.post(f"{self.url}/patients/{other['id']}/external-identifiers", json=request)
        self.assertEqual(conflict.status_code, 409)
        other_history = (await self.client.get(f"{self.url}/patients/{other['id']}/history")).json()
        self.assertEqual(len(other_history), 1)
        sibling_org = self.url + "-other"
        self.assertEqual((await self.client.get(f"{sibling_org}/patients/{patient['id']}")).status_code, 403)
        sibling = await create_account(self.org + "-other", "writer", "admin")
        await login(self.client, sibling.organization, sibling.username)
        self.assertEqual((await self.client.get(f"{sibling_org}/patients/{patient['id']}")).status_code, 404)
        await self.create("cases", {"case_number": "CROSS-ORG", "patient_id": patient["id"]}, organization_url=sibling_org, expected=404)
        sibling_patient = await self.create("patients", {"local_reference": "SYNTH-LOCAL"}, organization_url=sibling_org)
        second = await self.client.post(f"{sibling_org}/patients/{sibling_patient['id']}/external-identifiers", json=request)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertNotEqual(second.json()["identifier"]["id"], response.json()["identifier"]["id"])

    async def test_concurrent_retry_and_version_conflicts(self):
        body = {"case_number": "RETRY-001"}
        first, second = await asyncio.gather(
            self.create("cases", body, key="retry-test"),
            self.create("cases", body, key="retry-test"),
        )
        self.assertEqual(first["id"], second["id"])
        await self.create("cases", {"case_number": "CHANGED"}, key="retry-test", expected=409)
        await self.create("cases", body, expected=409)
        patients = [await self.create("patients", {"local_reference": reference}) for reference in ("ONE", "TWO")]
        scenario = f"{self.url}/cases/{first['id']}/patient"
        changes = await asyncio.gather(*[
            self.client.patch(scenario, json={"target_id": patient["id"], "version": 1, "reason": "Synthetic review"})
            for patient in patients
        ])
        self.assertEqual(sorted(change.status_code for change in changes), [200, 409])
        history = (await self.client.get(f"{self.url}/cases/{first['id']}/history")).json()
        self.assertEqual([event["version"] for event in history], [2, 1])
        with self.assertRaises(DBAPIError) as error:
            async with app.state.engine.begin() as connection:
                await connection.execute(text("UPDATE clinical_events SET action = 'invalid' WHERE organization = :org"), {"org": self.org})
        self.assertIn("append-only", str(error.exception))

    async def test_scan_paths_and_remote_access(self):
        slide = await self.create("slides", {"slide_number": "PATH-1"})
        (self.root / "target.svs").write_bytes(b"WSI location test")
        (self.root / "alias.svs").symlink_to(self.root / "target.svs")
        for path in ("../outside.svs", "/tmp/file.svs", "alias.svs", "file.png"):
            await self.create("scans", {"slide_id": slide["id"], "storage_key": path}, expected=422)
        await self.create("scans", {"slide_id": slide["id"], "storage_key": "missing.svs"}, expected=404)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("192.0.2.10", 12345)),
            base_url="http://localhost",
        ) as remote:
            response = await remote.get(self.url + "/patients", headers={"X-Forwarded-For":"127.0.0.1"})
            self.assertEqual(response.status_code, 401)

    async def test_authentication_and_worklist_scope(self):
        doctor = await create_account(self.org, "doctor", "doctor")
        viewer = await create_account(self.org, "viewer", "viewer")
        mine = await self.create("cases", {"case_number": "Demo-ALPHA-01"})
        other = await self.create("cases", {"case_number": "Demo-ALPHA-02"})
        unassigned = await self.create("cases", {"case_number": "Demo-BETA"})
        async with app.state.engine.begin() as connection:
            for record, assignee, status in ((mine, doctor, "in_review"), (other, viewer, "assigned")):
                await connection.execute(text(
                    "UPDATE cases SET assigned_to = :user, status = :status WHERE id = CAST(:id AS uuid)"
                ), {"id": record["id"], "user": assignee.id, "status": status})
        self.assertEqual((await self.client.get("/api/worklist?scope=unassigned")).json()["rows"][0]["record_id"], unassigned["id"])
        self.assertEqual((await self.client.get("/api/worklist?q=alpha")).json()["total"], 2)
        self.assertEqual((await self.client.get("/api/worklist?q=alpha&status=in_review")).json()["total"], 1)
        wrong_origin = await self.client.post("/api/auth/logout", headers={"Origin": "http://unrelated.example"})
        self.assertEqual(wrong_origin.status_code, 403)
        auth = await login(self.client, self.org, doctor.username)
        self.assertIn("HttpOnly", auth.headers["set-cookie"])
        self.assertIn("SameSite=strict", auth.headers["set-cookie"])
        mine_only = (await self.client.get("/api/worklist?scope=mine&q=alPHA&status=in_review")).json()
        self.assertEqual(mine_only["total"], 1)
        self.assertEqual(mine_only["counts"]["all"], 1)
        self.assertEqual(mine_only["rows"][0]["record_id"], mine["id"])
        self.assertIsNone(mine_only["rows"][0]["patient"])
        self.assertEqual((await self.client.get(f"/api/worklist/{other['id']}")).status_code, 404)
        self.assertEqual((await self.client.get(f"{self.url}/cases/{other['id']}")).status_code, 404)
        self.assertEqual((await self.client.get("/api/intake/slides")).status_code, 403)
        await self.create("cases", {"case_number": "DENIED"}, expected=403)
        await login(self.client, self.org, viewer.username)
        self.assertEqual((await self.client.get(f"/api/worklist/{other['id']}")).status_code, 200)
        await self.create("cases", {"case_number": "DENIED"}, expected=403)
        cookie = self.client.cookies.get("mediauto_session")
        self.assertEqual((await self.client.post("/api/auth/logout")).status_code, 200)
        self.assertEqual((await self.client.get("/api/worklist")).status_code, 401)
        self.assertEqual((await self.client.get("/api/worklist", headers={"Authorization": f"Bearer {cookie}"})).status_code, 401)
