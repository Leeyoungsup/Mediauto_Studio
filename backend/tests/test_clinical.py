import argparse
import asyncio
import json
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
from app.import_pdl1 import import_snapshot


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
        root_override = patch("app.wsi.DATA_ROOT", self.root)
        root_override.start()
        self.addCleanup(root_override.stop)
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

    async def test_wsi_scan_scope_and_source_errors(self):
        case = await self.create("cases", {"case_number": "WSI-TEST"})
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "A"})
        slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "S-01"})
        source = self.root / "corrupt.svs"
        source.write_bytes(b"not a slide")
        scan = await self.create("scans", {"slide_id": slide["id"], "storage_key": source.name})
        worklist = (await self.client.get(f"/api/worklist/{case['id']}")).json()
        self.assertEqual(worklist["slides"][0]["wsi"], {"id": scan["id"], "source": "clinical", "format": "SVS"})
        path = f"/api/wsi/clinical/{scan['id']}"
        # Use separately authenticated clients for sensitive endpoints and the parent case.
        viewer = await create_account(self.org, "wsi-viewer", "viewer")
        await login(self.client, self.org, viewer.username)
        for suffix in ("", "/overview.jpeg", "/label.jpeg", "/2/0/0.jpeg"):
            self.assertEqual((await self.client.get(path + suffix)).status_code, 404)
        async with app.state.engine.begin() as connection:
            await connection.execute(text("UPDATE cases SET assigned_to = :user WHERE id = CAST(:case AS uuid)"),
                                     {"user": viewer.id, "case": case["id"]})
        self.assertEqual((await self.client.get(path)).status_code, 422)
        self.assertEqual((await self.client.get(path + "/label.jpeg")).status_code, 422)
        self.assertEqual((await self.client.get(path + "/7/0/0.jpeg")).status_code, 400)
        source.write_bytes(b"the registered file changed")
        self.assertEqual((await self.client.get(path + "/overview.jpeg")).status_code, 409)
        source.unlink()
        self.assertEqual((await self.client.get(path)).status_code, 404)
        self.assertEqual((await self.client.post("/api/auth/logout")).status_code, 200)
        self.assertEqual((await self.client.get(path + "/2/0/0.jpeg")).status_code, 401)
        self.assertEqual((await self.client.get(path + "/label.jpeg")).status_code, 401)

    async def test_viewer_preferences_are_private_and_versioned(self):
        endpoint = "/api/viewer/preferences"
        response = await self.client.get(endpoint)
        self.assertEqual(response.status_code, 200, response.text)
        initial = response.json()
        self.assertEqual(initial["version"], 0)
        self.assertTrue(initial["settings"]["show_minimap"])
        draft = {"version": 0, "settings": {**initial["settings"], "tray_orientation": "horizontal",
            "show_label": True, "autopan_speed": 240, "autopan_direction": "down"}}
        result = await self.client.put(endpoint, json=draft)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json(), {**draft, "version": 1})
        self.assertEqual((await self.client.put(endpoint, json=draft)).status_code, 409)
        invalid = {"version": 1, "settings": {**draft["settings"], "autopan_speed": 10000}}
        self.assertEqual((await self.client.put(endpoint, json=invalid)).status_code, 422)
        self.assertEqual((await self.client.get(endpoint)).json(), result.json())

        other = await create_account(self.org, "viewer-preferences-other", "doctor")
        await login(self.client, self.org, other.username)
        self.assertEqual((await self.client.get(endpoint)).json(), initial)
        await create_account(self.org + "-foreign", self.user.username, "admin")
        await login(self.client, self.org + "-foreign", self.user.username)
        self.assertEqual((await self.client.get(endpoint)).json(), initial)
        await self.client.post("/api/auth/logout")
        self.assertEqual((await self.client.get(endpoint)).status_code, 401)

    async def test_case_assign_reassign_and_review_audit(self):
        doctors = [await create_account(self.org, f"reviewer-{i}", "doctor") for i in range(2)]
        staff = await create_account(self.org, "intake-staff", "labeler")
        off_site = await create_account(self.org + "-other", "foreign-doctor", "doctor")
        case = await self.create("cases", {"case_number": "WORKFLOW-TEST"})
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "A"})
        slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "WF-1"})
        assignment = f"{self.url}/cases/{case['id']}/assignment"
        review = f"{self.url}/cases/{case['id']}/review"

        async def change(url, version, expected=200, **fields):
            response = await self.client.patch(url, json={"version": version, "reason": "Synthetic reason", **fields})
            self.assertEqual(response.status_code, expected, response.text)
            return response.json()

        await change(assignment, 1, 422, assignee_id=str(off_site.id))
        await change(assignment, 1, 422, assignee_id=str(staff.id))
        await login(self.client, self.org, staff.username)
        await change(assignment, 1, 403, assignee_id=str(doctors[0].id))
        await login(self.client, self.org, self.user.username)
        candidates = (await self.client.get(f"/api/worklist/{case['id']}")).json()["candidates"]
        self.assertEqual({candidate["id"] for candidate in candidates}, {str(doctor.id) for doctor in doctors})
        one, two = await asyncio.gather(*[
            self.client.patch(assignment, json={"version": 1, "assignee_id": str(doctors[0].id), "reason": "Initial assignment"})
            for _ in range(2)
        ])
        self.assertEqual(sorted([one.status_code, two.status_code]), [200, 409])
        await change(review, 2, 403, status="in_review")
        await login(self.client, self.org, doctors[0].username)
        await change(review, 2, 409, status="in_review")
        await login(self.client, self.org, self.user.username)
        (self.root / "workflow.ndpi").write_bytes(b"synthetic scan path")
        await self.create("scans", {"slide_id": slide["id"], "storage_key": "workflow.ndpi"})
        await login(self.client, self.org, doctors[0].username)
        await change(review, 2, 409, status="reviewed")
        self.assertEqual((await change(review, 2, status="in_review"))["status"], "in_review")
        await login(self.client, self.org, self.user.username)
        reassigned = await change(assignment, 3, assignee_id=str(doctors[1].id))
        self.assertEqual(reassigned["status"], "assigned")
        await login(self.client, self.org, doctors[0].username)
        await change(review, 4, 404, status="in_review")
        self.assertEqual((await self.client.get("/api/worklist?scope=mine")).json()["rows"], [])
        await login(self.client, self.org, doctors[1].username)
        self.assertEqual((await self.client.get("/api/worklist?scope=mine")).json()["rows"][0]["record_id"], case["id"])
        await change(review, 4, status="in_review")
        await change(review, 5, status="reviewed", note="  Synthetic review note  ")
        await change(review, 6, 409, status="in_review")
        await login(self.client, self.org, self.user.username)
        await change(assignment, 6, 409, assignee_id=str(doctors[0].id))
        details = (await self.client.get(f"/api/worklist/{case['id']}")).json()
        self.assertEqual((details["status"], details["version"]), ("reviewed", 6))
        events = (await self.client.get(f"{self.url}/cases/{case['id']}/history")).json()
        self.assertEqual([event["action"] for event in events],
                         ["review_completed", "review_started", "reassigned", "review_started", "assigned", "registered"])
        self.assertEqual([event["id"] for event in details["audit"]], [event["id"] for event in events])
        self.assertEqual(events[0]["actor"], str(doctors[1].id))
        self.assertEqual(events[0]["after"]["review_note"], "Synthetic review note")
        self.assertEqual(details["audit"][0]["after"]["review_note"], "Synthetic review note")
        self.assertEqual(events[2]["before"]["assigned_to"], str(doctors[0].id))
        self.assertEqual(events[2]["after"]["assigned_to"], str(doctors[1].id))
        self.assertEqual(events[2]["source"], "ims")
        self.assertEqual(events[2]["reason"], "Synthetic reason")
        self.assertTrue(events[2]["occurred_at"])
        self.assertTrue(events[2]["transaction_id"])

    async def test_file_intake_confirmation_links_scans_atomically(self):
        organization = "local"
        writer = await create_account(organization, "intake-" + uuid4().hex, "labeler")
        await login(self.client, organization, writer.username)
        case_number = "CASE-" + uuid4().hex
        payload = []
        with patch("app.intake.DATA_ROOT", self.root):
            for ext in ("ndpi", "svs"):
                (self.root / f"{case_number}.{ext}").write_bytes(b"synthetic scan path")
            for file in (await self.client.get("/api/intake/slides")).json():
                result = await self.client.put(f"/api/intake/slides/{file['id']}", json={
                    "version": 0, "fields": {"case_id": case_number, "slide_id": "A-1", "stain": "HE"},
                })
                self.assertEqual(result.status_code, 200)
                payload.append({"id": file["id"], "version": 1})
            url = f"/api/clinical/local/files/{case_number}/case"
            self.assertEqual((await self.client.post(url, json={"files": [{**payload[0], "version": 2}, payload[1]]})).status_code, 409)
            result = await self.client.post(url, json={"files": payload})
            self.assertEqual(result.status_code, 201, result.text)
            case_id = result.json()["id"]
            self.assertEqual((await self.client.post(url, json={"files": payload})).status_code, 409)
            details = (await self.client.get(f"/api/worklist/{case_id}")).json()
            self.assertEqual({item["wsi"]["format"] for item in details["slides"]}, {"SVS", "NDPI"})
            self.assertEqual(details["audit"][0]["source"], "file_intake")
            scans = (await self.client.get("/api/clinical/local/scans")).json()
            for scan in scans:
                audit = (await self.client.get(f"/api/clinical/local/scans/{scan['id']}/history")).json()
                self.assertEqual(audit[0]["transaction_id"], details["audit"][0]["transaction_id"])
            self.assertEqual(len((await self.client.get("/api/intake/slides")).json()), 2)

    async def test_pdl1_snapshots_are_scan_and_role_scoped(self):
        case = await self.create("cases", {"case_number": "PDL1-TEST"})
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "A"})
        slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "SYNTH-PD"})
        source = self.root / "synthetic-pd.ndpi"
        source.write_bytes(b"synthetic scan")
        scan = await self.create("scans", {"slide_id": slide["id"], "storage_key": source.name})
        signature = {"filename": source.name, "size": source.stat().st_size, "quickhash": "synthetic", "dimensions": [100, 80]}
        raw = {"source": signature, "tissue_type": "Stomach", "pd_score": {"score_type": "CPS", "score": 25, "class_counts": {"0": 3, "2": 1, "3": 0}},
               "class_names": {"0": "Synthetic negative"}, "class_colors": {"0": "#112233"},
               "cells": [[20, 25, 0, 0.9], {"x": 60, "y": 60, "class_id": 0, "hidden": True}],
               "model_runtime": {"filename": "PDL1_ST_CPS_detection.pt", "version": "1"},
               "global_dedup_version": "synthetic-analysis"}
        file = self.root / "result.json"
        file.write_text(json.dumps(raw))
        export = self.root / "audit.json"
        export.write_text(json.dumps([{"action": "Cell corrected", "actor": "synthetic-editor",
                                       "occurred_at": "2026-01-01T00:00:00+00:00"}]))
        options = argparse.Namespace(
            organization=self.org, slide=source.name, result=file, original=None,
            editor=None, saved_at=None, audit=None, importer="fixture",
        )
        url = f"/api/wsi/clinical/{scan['id']}/pdl1"
        args = "?left=0&top=0&right=40&bottom=40"
        with patch.dict(os.environ, {"MEDIAUTO_PDL1_ROOT": str(self.root / "catalog")}), \
             patch("app.import_pdl1.DATA_ROOT", self.root), patch("app.import_pdl1.slide_signature", return_value=signature), \
             patch("app.pdl1.slide_signature", return_value=signature):
            original = import_snapshot(options)["id"]
            self.assertEqual(import_snapshot(options)["id"], original)
            raw["cells"] = [[30, 32, 0, 0.9]]
            file.write_text(json.dumps(raw))
            options.original, options.editor, options.audit = original, "synthetic-editor", export
            edited = import_snapshot(options)["id"]
            response = await self.client.get(url)
            self.assertEqual(response.status_code, 200, response.text)
            entries = response.json()["results"]
            self.assertEqual([record["id"] for record in entries], [original, edited])
            self.assertEqual(entries[0]["score"], 25)
            self.assertIsNone(entries[1]["score"])
            self.assertEqual(entries[1]["audit"][0]["action"], "Cell corrected")
            self.assertEqual(entries[1]["original_id"], original)
            request_create = f"{self.url}/cases/{case['id']}/requests"
            request = await self.client.post(request_create, json={"kind": "ai", "question": "Synthetic check",
                "scan_id": scan["id"], "assignee_id": str(self.user.id)}, headers={"Idempotency-Key": "synthetic-pd-link"})
            self.assertEqual(request.status_code, 201, request.text)
            request_path = f"{self.url}/requests/{request.json()['id']}"
            self.assertEqual((await self.client.patch(request_path, json={"version": 1, "action": "start"})).status_code, 200)
            self.assertEqual([item["id"] for item in (await self.client.get(request_path + "/results")).json()], [original, edited])
            payload = {"version": 2, "action": "complete", "snapshot_id": "0" * 64}
            self.assertEqual((await self.client.patch(request_path, json=payload)).status_code, 422)
            response = await self.client.patch(request_path, json={**payload, "snapshot_id": original})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["snapshot"]["id"], original)
            self.assertNotIn("score", response.json()["snapshot"])
            self.assertEqual((await self.client.get(f"{url}/{original}/cells{args}")).json()["points"], [[20, 25, 0]])
            self.assertEqual((await self.client.get(f"{url}/{edited}/cells{args}")).json()["points"], [[30, 32, 0]])
            self.assertEqual((await self.client.get(f"{url}/{edited}/cells?left=85&top=85&right=90&bottom=90")).json()["points"], [])
            raw["cells"] = [[100, 0, 0, 0.9]]
            file.write_text(json.dumps(raw))
            with self.assertRaisesRegex(ValueError, "outside"):
                import_snapshot(options)
            raw["source"] = {**signature, "quickhash": "wrong"}
            file.write_text(json.dumps(raw))
            with self.assertRaisesRegex(ValueError, "does not match"):
                import_snapshot(options)
            labeler = await create_account(self.org, "pdl1-labeler", "labeler")
            await login(self.client, self.org, labeler.username)
            self.assertEqual([entry["id"] for entry in (await self.client.get(url)).json()["results"]], [original])
            self.assertEqual((await self.client.get(f"{url}/{edited}/cells{args}")).status_code, 404)
            doctor = await create_account(self.org, "pdl1-doctor", "doctor")
            await login(self.client, self.org, doctor.username)
            self.assertEqual((await self.client.get(url)).status_code, 404)
            self.assertEqual((await self.client.post("/api/auth/logout")).status_code, 200)
            self.assertEqual((await self.client.get(url)).status_code, 401)

    async def wait_inbox(self, integration, message_id, state, attempts=None):
        for _ in range(100):
            response = await self.client.get(integration + "/messages")
            self.assertEqual(response.status_code, 200, response.text)
            row = next((row for row in response.json() if row["message_id"] == message_id), None)
            if row and row["state"] == state and (attempts is None or row["attempts"] == attempts):
                return row
            await asyncio.sleep(0.06)
        self.fail(f"Expected {state} for synthetic message {message_id}; last result was {row}")

    async def test_emr_message_order_and_explicit_patient_reconciliation(self):
        root = f"/api/integration/{self.org}"
        case = await self.create("cases", {"case_number": "EMR-DEMO"})
        actions = root + "/cases/" + case["id"]
        self.assertEqual((await self.client.get(root + "/status")).json()["emr"]["state"], "not_configured")
        self.assertEqual((await self.client.post(actions + "/patient-lookup", json={"external_id": "SYNTH-MRN"})).status_code, 409)
        manual = await self.client.post(actions + "/manual-patient", json={
            "case_version": 1, "display_name": "Synthetic local", "local_reference": "LOCAL-ONLY",
        })
        self.assertEqual(manual.status_code, 201, manual.text)
        patient = manual.json()
        self.assertEqual(patient["source"], "manual")
        self.assertEqual((await self.client.put(root + "/connections/emr", json={"mode": "mock", "version": 0})).status_code, 200)
        self.assertEqual((await self.client.post(root + "/connections/emr/probe")).json()["state"], "connected")
        self.assertEqual((await self.client.post(actions + "/patient-lookup", json={"external_id": "missing"})).json(),
                         {"match": "not_found"})
        inbox = root + "/connections/emr/messages"
        body = {"message_id": "EMR-2", "resource": "patient", "external_id": "SYNTH-MRN", "revision": 2,
                "data": {"display_name": "Synthetic external"}}

        async def send(data, expected=202):
            result = await self.client.post(inbox, json=data)
            self.assertEqual(result.status_code, expected, result.text)
            return result.json()

        original, duplicate = await asyncio.gather(send(body), send(body))
        self.assertEqual(original["id"], duplicate["id"])
        self.assertEqual(sorted((original["duplicate"], duplicate["duplicate"])), [False, True])
        await send({**body, "revision": 3}, 409)
        self.assertEqual((await self.wait_inbox(root, "EMR-2", "pending_link"))["delivery_conflicts"], 1)
        await send({**body, "message_id": "OLDER", "revision": 1, "data": {"display_name": "Old"}})
        await self.wait_inbox(root, "OLDER", "stale")
        await send({**body, "message_id": "REPLAY"})
        await self.wait_inbox(root, "REPLAY", "duplicate")
        await send({**body, "message_id": "SAME-REV", "data": {"display_name": "Contradiction"}})
        await self.wait_inbox(root, "SAME-REV", "conflict")
        lookup = (await self.client.post(actions + "/patient-lookup", json={"external_id": body["external_id"]})).json()
        self.assertEqual(lookup["data"]["display_name"], "Synthetic external")
        self.assertEqual(lookup["differences"], ["display_name"])
        confirm = {"external_id": body["external_id"], "case_version": 2, "patient_version": 1,
                   "source_revision": 2, "reason": "Verified synthetic reconciliation"}
        self.assertEqual((await self.client.post(actions + "/patient-confirm", json=confirm)).status_code, 409)
        confirmed = await self.client.post(actions + "/patient-confirm", json={**confirm, "confirm_differences": True})
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual(confirmed.json()["system"], "emr.mock")
        local = (await self.client.get(f"{self.url}/patients/{patient['id']}")).json()
        self.assertEqual(local["display_name"], "Synthetic local")
        self.assertEqual(local["version"], 2)
        history = (await self.client.get(f"{self.url}/patients/{patient['id']}/history")).json()
        self.assertEqual(history[0]["source"], "emr")
        self.assertEqual(history[0]["after"]["source_revision"], 2)
        new_body = {**body, "message_id": "NEW", "revision": 3, "data": {"display_name": "Changed external"}}
        await send(new_body)
        await self.wait_inbox(root, "NEW", "conflict")
        link = (await self.client.get(root + "/sources/patient/" + patient["id"])).json()[0]
        self.assertEqual((link["state"], link["source_revision"]), ("needs_review", 3))
        self.assertEqual((await self.client.post(actions + "/patient-confirm",
                          json={**confirm, "patient_version": 2, "confirm_differences": True})).status_code, 409)

        other = await self.create("cases", {"case_number": "EMR-OTHER"})
        other_url = root + "/cases/" + other["id"]
        other_patient = await self.client.post(other_url + "/manual-patient", json={
            "case_version": 1, "display_name": "Different local",
        })
        self.assertEqual(other_patient.status_code, 201)
        self.assertEqual((await self.client.post(other_url + "/patient-lookup",
                          json={"external_id": body["external_id"]})).json()["match"], "conflict")
        self.assertEqual((await self.client.post(other_url + "/patient-confirm",
                          json={**confirm, "source_revision": 3, "confirm_differences": True})).status_code, 409)

    async def test_notes_channel_preferences_deduplication_and_delivery_retry(self):
        import base64
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from app.notification_transport import DeliveryProblem

        doctor = await create_account(self.org, "notes-doctor", "doctor")
        outsider = await create_account(self.org, "notes-outsider", "doctor")
        foreign = await create_account(self.org + "-outside", "notes-foreign", "doctor")
        case = await self.create("cases", {"case_number": "NOTIFY-QA"})
        other = await self.create("cases", {"case_number": "NOTIFY-OTHER"})
        path = f"{self.url}/cases/{case['id']}/notes"
        notice = self.url + "/notifications"
        req = f"{self.url}/cases/{case['id']}/requests"

        async def check(call, code=200):
            response = await call
            self.assertEqual(response.status_code, code, response.text)
            return response.json()

        async def inbox():
            return await check(self.client.get(notice))

        async def wait_email(state):
            for _ in range(70):
                items = (await inbox())["deliveries"]
                matching = [item for item in items if item["event"] == "mention" and item["channel"] == "email"]
                if matching and matching[0]["status"] == state:
                    return matching[0]
                await asyncio.sleep(.07)
            self.fail(f"Expected mention email state {state}.")

        await login(self.client, self.org, doctor.username)
        settings = await check(self.client.get(notice + "/preferences"))
        self.assertTrue(settings["rules"]["mention"]["in_app"])
        self.assertFalse(settings["email_configured"])
        configuration = {"version": 0, "rules": {"mention": {"email": True, "push": True},
                                                    "request": {"in_app": False, "email": True}}}
        saved = await check(self.client.put(notice + "/preferences", json=configuration))
        self.assertEqual(saved["version"], 1)
        await check(self.client.put(notice + "/preferences", json=configuration), 409)
        await check(self.client.put(notice + "/push-subscription", json={
            "endpoint": "https://127.0.0.1/fcm/send/private", "keys": {"p256dh": "xyz", "auth": "xyz"},
        }), 422)
        private_key = ec.generate_private_key(ec.SECP256R1())
        encode = lambda data: base64.urlsafe_b64encode(data).decode().rstrip("=")
        push = {"endpoint": "https://fcm.googleapis.com/fcm/send/synthetic-token", "keys": {
            "p256dh": encode(private_key.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
            )),
            "auth": encode(b"0123456789abcdef"),
        }}
        await check(self.client.put(notice + "/push-subscription", json=push), 409)
        with patch("app.notifications.vapid_settings", return_value=("/unused", "mailto:ops@example.test", push["keys"]["p256dh"])):
            await check(self.client.put(notice + "/push-subscription", json=push))
            self.assertTrue((await check(self.client.get(notice + "/preferences")))["push_registered"])
            await check(self.client.delete(notice + "/push-subscription"))

        await login(self.client, self.org, self.user.username)
        assigned = await check(self.client.patch(f"{self.url}/cases/{case['id']}/assignment", json={
            "assignee_id": str(doctor.id), "version": case["version"], "reason": "Synthetic notification test",
        }))
        await check(self.client.patch(f"{self.url}/cases/{case['id']}/assignment", json={
            "assignee_id": str(doctor.id), "version": assigned["version"], "reason": "Repeat assignment",
        }))
        await check(self.client.post(path, json={"body": "@notes-outsider"}, headers={"Idempotency-Key": "blocked-mention"}), 422)
        await check(self.client.post(path, json={"body": "@notes-foreign"}, headers={"Idempotency-Key": "cross-mention"}), 422)

        with patch("app.notification_delivery.send_email", side_effect=[
            DeliveryProblem("provider_unavailable"), DeliveryProblem("provider_rejected", "failed"), None,
        ]) as email:
            note = {"body": "Synthetic note for @notes-doctor and @notes-doctor."}
            headers = {"Idempotency-Key": "note-once"}
            created = await check(self.client.post(path, json=note, headers=headers), 201)
            self.assertEqual(await check(self.client.post(path, json=note, headers=headers), 201), created)
            await check(self.client.post(path, json={"body": "changed"}, headers=headers), 409)
            await check(self.client.post(f"{self.url}/cases/{other['id']}/notes", json={
                "body": "Synthetic cross-case reply", "parent_id": created["id"],
            }, headers={"Idempotency-Key": "wrong-parent"}), 404)

            await login(self.client, self.org, doctor.username)
            self.assertEqual((await check(self.client.get(notice + "/preferences")))["rules"], saved["rules"])
            items = (await inbox())["items"]
            self.assertEqual(sorted(item["event"] for item in items), ["case_assignment", "mention"])
            mention = next(item for item in items if item["event"] == "mention")
            await check(self.client.post(notice + "/" + mention["id"] + "/read"))
            first = await wait_email("retry_wait")
            self.assertEqual(first["attempts"], 1)
            final = await wait_email("failed")
            self.assertEqual(final["attempts"], 2)
            await check(self.client.post(notice + "/" + final["id"] + "/retry"))
            self.assertEqual((await wait_email("delivered"))["id"], final["id"])
            self.assertEqual(email.call_count, 3)
            self.assertEqual({str(call.args[1]) for call in email.call_args_list}, {final["id"]})
            delivery = next(item for item in (await inbox())["deliveries"] if item["channel"] == "push")
            self.assertEqual((delivery["status"], delivery["error"]), ("blocked", "channel_not_configured"))
            await check(self.client.post(path, json={"body": "Synthetic reply", "parent_id": created["id"]},
                         headers={"Idempotency-Key": "reply-once"}), 201)
            self.assertEqual((await check(self.client.get(path)))["notes"][0]["comments"][0]["body"], "Synthetic reply")

        await login(self.client, self.org, self.user.username)
        self.assertEqual([item["event"] for item in (await inbox())["items"]], ["case_comment"])
        request = {"kind": "consult", "question": "Synthetic consultation", "assignee_id": str(doctor.id)}
        for _ in range(2):
            await check(self.client.post(req, json=request, headers={"Idempotency-Key": "notify-request"}), 201)
        await check(self.client.post(notice + "/" + mention["id"] + "/read"), 404)
        await login(self.client, self.org, doctor.username)
        self.assertFalse(any(item["event"] == "request" for item in (await inbox())["items"]))
        self.assertEqual(sum(item["event"] == "request" for item in (await inbox())["deliveries"]), 1)
        await login(self.client, self.org, outsider.username)
        await check(self.client.get(path), 404)
        self.assertFalse((await inbox())["items"])
        await login(self.client, foreign.organization, foreign.username)
        await check(self.client.get(path), 403)

    async def test_case_logs_scope_filters_attempts_and_annotation_changes(self):
        case = await self.create("cases", {"case_number": "AUDIT-QA"})
        unrelated = await self.create("cases", {"case_number": "AUDIT-OTHER"})
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "A"})
        slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "AUDIT-S"})
        sample = self.root / "audit.ndpi"
        sample.write_bytes(b"damaged input for failure audit")
        scan = await self.create("scans", {"slide_id": slide["id"], "storage_key": sample.name})
        base = "/api/wsi/clinical/" + scan["id"]
        path = self.url + "/cases/" + case["id"] + "/logs"

        async def check(request, code=200):
            response = await request
            self.assertEqual(response.status_code, code, response.text)
            return response

        async def rows(**params):
            response = await check(self.client.get(path, params=params))
            return response.json()["rows"]

        attempt = str(uuid4())
        header = {"X-Audit-Attempt": attempt}
        for _ in range(2):
            await check(self.client.post("/api/worklist/cases/" + case["id"] + "/opened", headers=header))
        await check(self.client.get(base, headers=header), 422)
        await check(self.client.post(base + "/view-events", json={"attempt_id": attempt, "result": "failed"}), 204)
        await check(self.client.post(base + "/view-events", json={"attempt_id": str(uuid4()), "result": "success"}), 204)
        self.assertEqual(len(await rows(action="case_opened")), 1)
        self.assertEqual(len(await rows(action="scan_viewed", result="success")), 1)
        failure = await rows(action="scan_viewed", result="failed", target_id=scan["id"])
        self.assertEqual([event["status_code"] for event in failure], [422])

        annotation = {"id": str(uuid4()), "kind": "rectangle", "label": "Initial overlay", "points": [[3, 4], [10, 12]]}
        annotations = base + "/viewer-records/annotations"
        with patch("app.viewer_records.scan_response", return_value={"dimensions": [120, 100], "mpp_x": None, "mpp_y": None}):
            for _ in range(2):
                await check(self.client.post(annotations, json=annotation), 201)
        mark = annotations + "/" + annotation["id"]
        renamed = await check(self.client.patch(mark, json={"version": 1, "label": "Revised overlay"}))
        self.assertEqual(renamed.json()["version"], 2)
        await check(self.client.patch(mark, json={"version": 1, "label": "Stale overlay"}), 409)
        for _ in range(2):
            await check(self.client.delete(mark))
        successful = await rows(entity="annotation", result="success", target_id=annotation["id"])
        self.assertEqual([event["action"] for event in successful],
                         ["annotation_deleted", "annotation_updated", "annotation_registered"])
        self.assertTrue(successful[0]["after"]["deleted"])
        self.assertEqual((successful[1]["before"]["label"], successful[1]["after"]["label"]),
                         ("Initial overlay", "Revised overlay"))
        self.assertEqual(successful[1]["before"]["points"], annotation["points"])
        self.assertEqual([x["status_code"] for x in await rows(action="annotation_updated", result="failed")], [409])

        doctor = await create_account(self.org, "audit-doctor", "doctor")
        labeler = await create_account(self.org, "audit-labeler", "labeler")
        await login(self.client, self.org, doctor.username)
        await check(self.client.get(path), 404)
        await check(self.client.get(base), 404)
        await check(self.client.get("/api/worklist/" + case["id"]), 404)
        await login(self.client, self.org, labeler.username)
        await check(self.client.get(path), 403)
        foreign = await create_account(self.org + "-outside", "audit-foreign", "admin")
        await login(self.client, foreign.organization, foreign.username)
        await check(self.client.get(path), 403)
        await check(self.client.get(base), 404)
        await login(self.client, self.org, self.user.username)

        denied = await rows(result="denied", actor=str(doctor.id))
        self.assertEqual(sorted(event["action"] for event in denied), ["case_opened", "scan_viewed"])
        self.assertFalse(await rows(actor=str(foreign.id)))
        other = await check(self.client.get(self.url + "/cases/" + unrelated["id"] + "/logs"))
        self.assertFalse(any(event["target_id"] == scan["id"] for event in other.json()["rows"]))

        for _ in range(32):
            await check(self.client.post(base + "/view-events", json={"attempt_id": str(uuid4()), "result": "success"}), 204)
        first = (await check(self.client.get(path, params={"action": "scan_viewed", "result": "success"}))).json()
        self.assertEqual(len(first["rows"]), 30)
        self.assertTrue(first["has_more"])
        cursor = first["rows"][-1]
        second = await rows(action="scan_viewed", result="success", before_at=cursor["occurred_at"], before_id=cursor["id"])
        self.assertEqual(len(second), 3)
        self.assertFalse({event["id"] for event in first["rows"]} & {event["id"] for event in second})

        transferred = await self.create("specimens", {"case_id": unrelated["id"], "specimen_number": "B"})
        await check(self.client.patch(self.url + "/slides/" + slide["id"] + "/specimen", json={
            "target_id": transferred["id"], "version": slide["version"], "reason": "Synthetic transfer",
        }))
        self.assertEqual(len(await rows(entity="annotation", result="success", target_id=annotation["id"])), 3)
        new_case = await check(self.client.get(self.url + "/cases/" + unrelated["id"] + "/logs"))
        self.assertFalse(any(event["target_id"] in (scan["id"], annotation["id"]) for event in new_case.json()["rows"]))

    async def test_case_attachments_validate_scope_contents_and_download_audit(self):
        import io
        from PIL import Image

        case = await self.create("cases", {"case_number": "MEDIA-QA"})
        other_case = await self.create("cases", {"case_number": "MEDIA-OTHER"})
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "A"})
        other_specimen = await self.create("specimens", {"case_id": other_case["id"], "specimen_number": "A"})
        path = self.url + "/cases/" + case["id"] + "/attachments"
        other_path = self.url + "/cases/" + other_case["id"] + "/attachments"

        async def check(pending, code):
            response = await pending
            self.assertEqual(response.status_code, code, response.text[:500])
            return response

        def upload(kind, content, key, target=None):
            return self.client.post(path + "/" + kind, params={"specimen_id": target} if target else {},
                content=content, headers={"Idempotency-Key": key, "X-File-Name": "synthetic%20attachment." + ("pdf" if kind == "pdf" else "png")})

        raw_pdf, raw_png = io.BytesIO(), io.BytesIO()
        with Image.new("RGB", (140, 100), "white") as first, Image.new("RGB", (120, 80), "blue") as second:
            first.save(raw_pdf, "PDF", save_all=True, append_images=[second])
            first.save(raw_png, "PNG")
        pdf, png = raw_pdf.getvalue(), raw_png.getvalue()

        await check(upload("pdf", png, "spoofed-pdf"), 415)
        await check(upload("pdf", b"%PDF-1.7\ncorrupted", "damaged-pdf"), 422)
        await check(upload("gross", b"\x89PNG\r\n\x1a\ncorrupt", "damaged-photo", specimen["id"]), 422)
        await check(upload("gross", pdf, "spoofed-photo", specimen["id"]), 415)
        await check(upload("gross", png, "missing-specimen"), 422)
        await check(upload("pdf", pdf, "unexpected-specimen", specimen["id"]), 422)
        await check(upload("gross", png, "wrong-specimen", other_specimen["id"]), 404)
        await check(self.client.post(path + "/pdf", content=b"x", headers={"Idempotency-Key": "oversize",
            "X-File-Name": "large.pdf", "Content-Length": str(10 * 1024 * 1024 + 1)}), 413)

        document = (await check(upload("pdf", pdf, "pdf-one"), 201)).json()
        self.assertEqual(document["pages"], 2)
        self.assertEqual((await check(upload("pdf", pdf, "pdf-one"), 201)).json()["id"], document["id"])
        image = (await check(upload("gross", png, "gross-one", specimen["id"]), 201)).json()
        self.assertEqual(image["filename"], "synthetic attachment.jpg")
        self.assertEqual(image["specimen_id"], specimen["id"])
        await check(upload("gross", png, "pdf-one", specimen["id"]), 409)
        with patch("app.case_attachments.MAX_ATTACHMENTS", 2):
            await check(upload("pdf", pdf, "over-case-count"), 413)

        pdf_route = path + "/pdf/" + document["id"]
        gross_route = path + "/gross/" + image["id"]
        listing = (await check(self.client.get(path + "/gross"), 200)).json()
        self.assertEqual([row["id"] for row in listing["specimens"]], [specimen["id"]])
        self.assertEqual(listing["records"][0], image)
        await check(self.client.get(other_path + "/pdf/" + document["id"] + "/preview"), 404)
        await check(self.client.post(other_path + "/pdf/" + document["id"] + "/download"), 404)
        await check(self.client.get(path + "/gross/" + document["id"] + "/preview"), 404)
        page = await check(self.client.get(pdf_route + "/preview?page=2"), 200)
        self.assertEqual(page.headers["content-type"], "image/png")
        self.assertTrue(page.content.startswith(b"\x89PNG"))
        await check(self.client.get(pdf_route + "/preview?page=3"), 404)
        photo = await check(self.client.get(gross_route + "/preview"), 200)
        self.assertEqual(photo.headers["content-type"], "image/jpeg")
        with Image.open(io.BytesIO(photo.content)) as decoded:
            self.assertEqual(decoded.size, (140, 100))
            self.assertFalse(decoded.getexif())
        downloaded_photo = await check(self.client.post(gross_route + "/download"), 200)
        self.assertNotEqual(downloaded_photo.content, photo.content)
        events = (await check(self.client.get(pdf_route + "/activity"), 200)).json()
        self.assertEqual([event["action"] for event in events], ["attachment_registered"])

        viewer = await create_account(self.org, "attachment-viewer", "viewer")
        await login(self.client, self.org, viewer.username)
        await check(self.client.get(pdf_route + "/preview"), 404)
        await check(self.client.post(pdf_route + "/download"), 404)
        async with app.state.engine.begin() as connection:
            await connection.execute(text("UPDATE cases SET assigned_to = :user WHERE id = CAST(:case AS uuid)"),
                                     {"user": viewer.id, "case": case["id"]})
        self.assertFalse((await check(self.client.get(path + "/pdf"), 200)).json()["can_upload"])
        await check(upload("pdf", pdf, "viewer-write"), 403)
        first, second = await asyncio.gather(
            check(self.client.post(pdf_route + "/download"), 200),
            check(self.client.post(pdf_route + "/download"), 200),
        )
        self.assertEqual((first.content, second.content), (pdf, pdf))
        self.assertEqual(first.headers["cache-control"], "private, no-store")
        self.assertTrue(first.headers["content-disposition"].startswith("attachment;"))
        events = (await check(self.client.get(pdf_route + "/activity"), 200)).json()
        self.assertEqual([event["action"] for event in events], ["attachment_downloaded", "attachment_downloaded", "attachment_registered"])
        self.assertEqual(events[0]["actor"], viewer.username)

        async with app.state.engine.begin() as connection:
            await connection.execute(text("UPDATE case_attachments SET content = :broken WHERE id = CAST(:id AS uuid)"),
                                     {"id": document["id"], "broken": b"broken"})
        await check(self.client.get(pdf_route + "/preview"), 422)
        await check(self.client.post(pdf_route + "/download"), 422)
        self.assertEqual(len((await check(self.client.get(pdf_route + "/activity"), 200)).json()), 3)

    async def test_patient_history_matches_confirmed_source_and_case_permissions(self):
        root = f"/api/integration/{self.org}"
        patient = await self.create("patients", {"display_name": "Synthetic history patient"})
        other = await self.create("patients", {"display_name": "Synthetic other patient"})
        case = await self.create("cases", {"case_number": "HISTORY-ONE", "patient_id": patient["id"]})
        sibling = await self.create("cases", {"case_number": "HISTORY-TWO", "patient_id": patient["id"]})
        unrelated = await self.create("cases", {"case_number": "HISTORY-OTHER", "patient_id": other["id"]})
        orphan = await self.create("cases", {"case_number": "HISTORY-NO-PATIENT"})
        path = self.url + "/cases/" + case["id"] + "/patient-history"
        config = root + "/connections/"

        async def check(request, code=200):
            response = await request
            self.assertEqual(response.status_code, code, response.text)
            return response.json()

        async def state():
            return await check(self.client.get(path))

        async def send(channel, message, expected):
            await check(self.client.post(config + channel + "/messages", json=message), 202)
            return await self.wait_inbox(root, message["message_id"], expected)

        self.assertEqual((await state())["connections"]["emr"]["state"], "not_configured")
        self.assertEqual((await state())["match"], "not_linked")
        empty_path = self.url + "/cases/" + orphan["id"] + "/patient-history"
        self.assertEqual((await check(self.client.get(empty_path)))["match"], "no_patient")
        record = {"kind": "encounter_note", "title": "Manual synthetic encounter",
                  "occurred_on": "2026-10-23", "body": "Manual clinical body", "case_version": 1}
        header = {"Idempotency-Key": "history-manual"}
        await check(self.client.post(empty_path, json=record, headers=header), 409)
        local = await check(self.client.post(path, json=record, headers=header), 201)
        self.assertEqual(await check(self.client.post(path, json=record, headers=header), 201), local)
        await check(self.client.post(path, json={**record, "body": "changed"}, headers=header), 409)
        for channel in ("emr", "lis"):
            await check(self.client.put(config + channel, json={"version": 0, "mode": "mock"}))

        identity = {"message_id": "H-PATIENT", "resource": "patient", "external_id": "H-MRN", "revision": 1,
                    "data": {"display_name": patient["display_name"]}}
        await send("emr", identity, "pending_link")
        external = {"message_id": "H-DOC", "resource": "history", "external_id": "H-PRIVATE/DOC", "revision": 1,
                    "data": {"patient_external_id": "H-MRN", "kind": "diagnostic_report", "title": "External report",
                             "body": "External clinical body", "occurred_on": "2026-10-24"}}
        await send("emr", external, "applied")
        self.assertEqual([item["source"] for item in (await state())["records"]], ["manual"])
        generic = await check(self.client.post(self.url + "/patients/" + patient["id"] + "/external-identifiers", json={
            "system": "emr.mock", "kind": "MRN", "value": "H-MRN", "version": 1, "reason": "Generic import",
        }))
        self.assertEqual(generic["record_version"], 2)
        self.assertEqual((await state())["match"], "not_linked")
        actions = root + "/cases/" + case["id"] + "/patient-confirm"
        confirm = {"external_id": "H-MRN", "case_version": 1, "patient_version": 2, "source_revision": 1,
                   "reason": "Synthetic external match verified"}
        await check(self.client.post(actions, json=confirm))
        result = await state()
        self.assertEqual(result["match"], "linked")
        self.assertIsNone(result["connections"]["lis"]["last_received_at"])
        self.assertEqual([item["source"] for item in result["records"]], ["emr", "manual"])
        doc = result["records"][0]
        self.assertNotIn("body", doc)
        self.assertNotIn("H-PRIVATE", str(result))
        params = {"source": "emr", "record_id": doc["id"]}
        self.assertEqual((await check(self.client.get(path + "/document", params=params)))["body"], "External clinical body")
        same_patient = self.url + "/cases/" + sibling["id"] + "/patient-history/document"
        self.assertEqual((await check(self.client.get(same_patient, params={"record_id": local["id"], "source": "manual"})))["body"], record["body"])
        await check(self.client.get(self.url + "/cases/" + unrelated["id"] + "/patient-history/document", params=params), 404)

        await send("lis", {**external, "message_id": "H-LIS"}, "applied")
        await send("emr", {**external, "message_id": "H-DOC-REPLAY"}, "duplicate")
        await send("emr", {**external, "message_id": "H-DOC-UPDATE", "revision": 3,
                           "data": {**external["data"], "body": "Latest clinical body"}}, "applied")
        await send("emr", {**external, "message_id": "H-DOC-STALE", "revision": 2}, "stale")
        change = await send("emr", {**external, "message_id": "H-DOC-MOVE", "revision": 4,
                                   "data": {**external["data"], "patient_external_id": "H-OTHER"}}, "conflict")
        self.assertEqual(change["error"], "history_patient_identifier_changed")
        self.assertEqual((await check(self.client.get(path + "/document", params=params)))["body"], "Latest clinical body")
        await check(self.client.put(config + "emr", json={"version": 1, "mode": "mock", "scenario": "timeout"}))
        outage = asyncio.create_task(self.client.post(config + "emr/probe"))
        self.assertEqual(len((await state())["records"]), 3)
        self.assertEqual((await outage).status_code, 503)
        cached = await state()
        self.assertEqual(cached["connections"]["emr"]["state"], "degraded")
        self.assertIsNotNone(cached["connections"]["emr"]["last_received_at"])

        assigned = await create_account(self.org, "history-assigned", "doctor")
        not_assigned = await create_account(self.org, "history-unassigned", "doctor")
        labeler = await create_account(self.org, "history-labeler", "labeler")
        async with app.state.engine.begin() as connection:
            await connection.execute(text("UPDATE cases SET assigned_to = :user WHERE id = CAST(:case AS uuid)"),
                                     {"user": assigned.id, "case": case["id"]})
        await login(self.client, self.org, assigned.username)
        self.assertEqual((await check(self.client.get(path + "/document", params=params)))["body"], "Latest clinical body")
        await login(self.client, self.org, not_assigned.username)
        await check(self.client.get(path), 404)
        await check(self.client.get(path + "/document", params=params), 404)
        await login(self.client, self.org, labeler.username)
        await check(self.client.get(path), 403)
        await check(self.client.post(path, json=record, headers=header), 403)
        await create_account(self.org + "-foreign", "other-admin", "admin")
        await login(self.client, self.org + "-foreign", "other-admin")
        await check(self.client.get(path), 403)

        await login(self.client, self.org, self.user.username)
        await check(self.client.put(config + "emr", json={"version": 2, "mode": "mock"}))
        await send("emr", {**identity, "message_id": "H-PATIENT-CONFLICT", "revision": 2,
                           "data": {"display_name": "Different external patient"}}, "conflict")
        hidden = await state()
        self.assertEqual(hidden["match"], "needs_review")
        self.assertEqual([item["source"] for item in hidden["records"]], ["manual"])
        await check(self.client.get(path + "/document", params=params), 404)

    async def test_lis_timeout_retry_dead_letter_and_local_independence(self):
        root = f"/api/integration/{self.org}"
        config = root + "/connections/lis"
        self.assertEqual((await self.client.put(config, json={"version": 0, "mode": "mock", "scenario": "timeout"})).status_code, 200)
        failure = asyncio.create_task(self.client.post(config + "/probe"))
        case = await self.create("cases", {"case_number": "LIS-DEMO"})
        self.assertEqual((await self.client.get("/api/worklist")).status_code, 200)
        self.assertEqual((await self.client.get("/api/health")).status_code, 200)
        self.assertEqual((await failure).status_code, 503)
        self.assertEqual((await self.client.get(root + "/status")).json()["lis"]["state"], "degraded")
        target = f"{self.url}/cases/{case['id']}/external-identifiers"
        linked = await self.client.post(target, json={"system": "lis.mock", "kind": "ACCESSION", "value": "SYNTH-ACC",
                                                       "version": 1, "reason": "Verified external accession"})
        self.assertEqual(linked.status_code, 200, linked.text)
        envelope = {"message_id": "LIS-TIMEOUT", "resource": "case", "external_id": "SYNTH-ACC", "revision": 7,
                    "data": {"external_state": "released"}}
        submitted = await self.client.post(config + "/messages", json=envelope)
        self.assertEqual(submitted.status_code, 202, submitted.text)
        record_id = submitted.json()["id"]
        for attempt in range(1, 4):
            row = await self.wait_inbox(root, "LIS-TIMEOUT", "retry_wait", attempt)
            self.assertEqual(row["error"], "timeout")
            async with app.state.engine.begin() as connection:
                await connection.execute(text("UPDATE integration_messages SET next_attempt_at=now() WHERE id=CAST(:id AS uuid)"),
                                         {"id": record_id})
        await self.wait_inbox(root, "LIS-TIMEOUT", "dead_letter", 4)
        self.assertEqual((await self.client.put(config, json={"version": 1, "mode": "mock"})).status_code, 200)
        self.assertEqual((await self.client.post(root + f"/messages/{record_id}/retry")).status_code, 200)
        await self.wait_inbox(root, "LIS-TIMEOUT", "applied", 1)
        source = (await self.client.get(root + "/sources/case/" + case["id"])).json()
        self.assertEqual((source[0]["external_state"], source[0]["source_revision"]), ("released", 7))
        worklist = await self.client.get("/api/worklist", params={"lis_status": "RELEASED", "lis_data": "available"})
        self.assertEqual(worklist.status_code, 200, worklist.text)
        row = worklist.json()["rows"][0]
        self.assertEqual(row["record_id"], case["id"])
        self.assertEqual((row["lis_status"], row["lis_sources"][0]["source"]), ("released", "lis.mock"))

        self.assertEqual((await self.client.get(f"/api/worklist/{case['id']}")).json()["status"], "registered")
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "A"})
        slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "LIS-SLIDE"})
        for resource, local, kind in (("specimen", specimen, "SPECIMEN_ID"), ("slide", slide, "SLIDE_ID")):
            identifier = await self.client.post(f"{self.url}/{resource}s/{local['id']}/external-identifiers",
                json={"system": "lis.mock", "kind": kind, "value": kind, "version": 1, "reason": "Synthetic source mapping"})
            self.assertEqual(identifier.status_code, 200)
            message = await self.client.post(config + "/messages",
                json={"message_id": kind, "resource": resource, "external_id": kind, "revision": 1,
                      "data": {"external_state": "available"}})
            self.assertEqual(message.status_code, 202)
            await self.wait_inbox(root, kind, "applied")
            source_record = (await self.client.get(root + f"/sources/{resource}/{local['id']}")).json()[0]
            self.assertEqual(source_record["external_state"], "available")
        self.assertEqual((await self.client.put(config, json={"version": 2, "mode": "disabled"})).status_code, 200)
        self.assertTrue((await self.client.post(config + "/messages", json=envelope)).json()["duplicate"])
        self.assertEqual((await self.client.post(config + "/messages", json={**envelope, "message_id": "OTHER"})).status_code, 409)
        staff = await create_account(self.org, "lis-labeler", "labeler")
        await login(self.client, self.org, staff.username)
        self.assertEqual((await self.client.get(root + "/messages")).status_code, 403)
        self.assertEqual((await self.client.put(config, json={"version": 2, "mode": "disabled"})).status_code, 403)

    async def test_viewer_persistence_distance_and_permission(self):
        case = await self.create("cases", {"case_number": "VIEWER-TEST"})
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "A"})
        slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "SYNTH-ROI"})
        for name in ("viewer.ndpi", "other.svs"):
            (self.root / name).write_bytes(b"synthetic scan path")
        scan = await self.create("scans", {"slide_id": slide["id"], "storage_key": "viewer.ndpi"})
        other = await self.create("scans", {"slide_id": slide["id"], "storage_key": "other.svs"})
        url = f"/api/wsi/clinical/{scan['id']}/viewer-records"
        second_url = f"/api/wsi/clinical/{other['id']}/viewer-records"
        metadata = {"dimensions": [1000, 800], "mpp_x": 0.25, "mpp_y": 0.5}
        camera = {"x": 201.5, "y": 186.25, "zoom": 0.2, "version": 0}
        mark = {"id": str(uuid4()), "kind": "distance", "points": [[100, 100], [112, 108]], "label": "Synthetic distance"}
        roi = {"id": str(uuid4()), "kind": "rectangle", "points": [[20, 25], [160, 198]]}
        with patch("app.viewer_records.scan_response", return_value=metadata) as scan_info:
            self.assertIsNone((await self.client.get(url)).json()["position"])
            reply = await self.client.put(url + "/position", json=camera)
            self.assertEqual(reply.status_code, 200, reply.text)
            self.assertEqual((await self.client.put(url + "/position", json=camera)).status_code, 409)
            self.assertEqual((await self.client.put(url + "/position", json={**camera, "x": 1000, "version": 1})).status_code, 422)
            competing = await asyncio.gather(*[
                self.client.put(url + "/position", json={**camera, "zoom": zoom, "version": 1}) for zoom in (0.4, 0.8)
            ])
            self.assertEqual(sorted(response.status_code for response in competing), [200, 409])
            created = await self.client.post(url + "/annotations", json=mark)
            self.assertEqual(created.status_code, 201, created.text)
            self.assertEqual((created.json()["length"], created.json()["unit"]), (5.0, "um"))
            self.assertEqual((await self.client.post(url + "/annotations", json=mark)).status_code, 201)
            self.assertEqual((await self.client.post(url + "/annotations", json={**mark, "label": "new"})).status_code, 409)
            self.assertEqual((await self.client.post(url + "/annotations", json=roi)).status_code, 201)
            bad = {**roi, "id": str(uuid4()), "points": [[200, 300], [200, 350]]}
            self.assertEqual((await self.client.post(url + "/annotations", json=bad)).status_code, 422)
            scan_info.return_value = {**metadata, "mpp_y": None}
            pixels = await self.client.post(second_url + "/annotations", json={
                **mark, "id": str(uuid4()), "points": [[100, 100], [103, 104]],
            })
            self.assertEqual((pixels.json()["length"], pixels.json()["unit"]), (5.0, "px"))
            self.assertEqual((await self.client.delete(second_url + "/annotations/" + roi["id"])).status_code, 404)
            self.assertEqual((await self.client.post("/api/auth/logout")).status_code, 200)
            self.assertEqual((await self.client.get(url)).status_code, 401)
            await login(self.client, self.org, self.user.username)
            records = (await self.client.get(url)).json()
            self.assertEqual(records["position"]["x"], camera["x"])
            self.assertEqual(records["position"]["version"], 2)
            self.assertEqual(len(records["annotations"]), 2)
            self.assertEqual(next(row["points"] for row in records["annotations"] if row["id"] == mark["id"]), mark["points"])
            self.assertEqual((await self.client.get(second_url)).json()["position"], None)
            doctor = await create_account(self.org, "roi-doctor", "doctor")
            await login(self.client, self.org, doctor.username)
            self.assertEqual((await self.client.get(url)).status_code, 404)
            async with app.state.engine.begin() as connection:
                await connection.execute(text("UPDATE cases SET assigned_to=:user WHERE id=CAST(:id AS uuid)"),
                                         {"user": doctor.id, "id": case["id"]})
            self.assertIsNone((await self.client.get(url)).json()["position"])
            self.assertEqual((await self.client.delete(url + "/annotations/" + roi["id"])).status_code, 403)
            self.assertEqual((await self.client.post(url + "/annotations", json={**roi, "id": str(uuid4())})).status_code, 201)
            labeler = await create_account(self.org, "roi-labeler", "labeler")
            await login(self.client, self.org, labeler.username)
            self.assertFalse((await self.client.get(url)).json()["can_annotate"])
            self.assertEqual((await self.client.post(url + "/annotations", json=roi)).status_code, 403)
            await login(self.client, self.org, self.user.username)
            self.assertEqual((await self.client.delete(url + "/annotations/" + roi["id"])).status_code, 200)
            self.assertFalse(any(row["id"] == roi["id"] for row in (await self.client.get(url)).json()["annotations"]))
            async with app.state.engine.begin() as connection:
                actions = await connection.execute(text(
                    "SELECT action FROM clinical_events WHERE record_id=CAST(:id AS uuid) ORDER BY version"
                ), {"id": roi["id"]})
                self.assertEqual(list(actions.scalars()), ["annotation_registered", "annotation_deleted"])

    async def test_saved_worklist_preferences_and_shared_permissions(self):
        views = '/api/worklist/views'
        prefs = '/api/worklist/preferences'
        doctor = await create_account(self.org, 'view-doctor', 'doctor')
        admin = await create_account(self.org, 'view-admin', 'admin')
        outsider = await create_account(self.org + '-outside', 'outside', 'admin')
        columns = [{'id': 'created', 'visible': True}, {'id': 'specimen', 'visible': False}]
        configuration = {'q': 'VIEW-', 'status': 'registered', 'columns': columns,
                         'order': [{'field': 'slide_count', 'direction': 'desc'},
                                   {'field': 'case_number', 'direction': 'asc'}]}

        async def create_view(name, visibility):
            return await self.client.post(views, json={
                'name': name, 'visibility': visibility, 'configuration': configuration,
            })

        async def expect(response, status):
            result = await response
            self.assertEqual(result.status_code, status, result.text)
            return result.json()

        personal = await expect(create_view('Personal', 'private'), 201)
        shared = await expect(create_view('Shared', 'shared'), 201)
        default = {'default_view_id': personal['id'], 'columns': columns, 'version': 0}
        stored = await expect(self.client.put(prefs, json=default), 200)
        self.assertEqual(stored, {**default, 'version': 1})
        await expect(self.client.put(prefs, json=default), 409)

        await login(self.client, self.org, doctor.username)
        self.assertEqual([view['id'] for view in await expect(self.client.get(views), 200)], [shared['id']])
        self.assertFalse((await expect(self.client.get(views), 200))[0]['can_edit'])
        await expect(create_view('Unauthorized', 'shared'), 403)
        await expect(create_view('Doctor personal', 'private'), 201)
        update = {'name': 'Change', 'configuration': configuration, 'version': 1}
        for view, denied in ((personal, 404), (shared, 403)):
            await expect(self.client.put(f"{views}/{view['id']}", json=update), denied)
            await expect(self.client.delete(f"{views}/{view['id']}?version=1"), denied)
        await expect(self.client.put(prefs, json=default), 404)

        await login(self.client, outsider.organization, outsider.username)
        self.assertEqual(await expect(self.client.get(views), 200), [])
        await expect(self.client.put(prefs, json={**default, 'default_view_id': shared['id']}), 404)

        await login(self.client, self.org, admin.username)
        self.assertEqual([view['id'] for view in await expect(self.client.get(views), 200)], [shared['id']])
        changed = await expect(self.client.put(f"{views}/{shared['id']}", json=update), 200)
        self.assertEqual(changed['version'], 2)
        await expect(self.client.put(f"{views}/{shared['id']}", json=update), 409)

        await login(self.client, self.org, self.user.username)
        self.assertEqual(await expect(self.client.get(prefs), 200), stored)
        await expect(self.client.delete(f"{views}/{personal['id']}?version=1"), 200)
        self.assertIsNone((await expect(self.client.get(prefs), 200))['default_view_id'])

    async def test_case_request_permissions_retry_history_and_notification_deduplication(self):
        doctor = await create_account(self.org, "request-doctor", "doctor")
        other = await create_account(self.org, "request-other", "doctor")
        outsider = await create_account(self.org + "-outside", "outside", "admin")
        case = await self.create("cases", {"case_number": "REQUEST-01"})
        url = f"{self.url}/cases/{case['id']}/requests"
        inbox = self.url + "/request-notifications"
        body = {"kind": "consult", "question": "Synthetic review", "assignee_id": str(doctor.id)}
        headers = {"Idempotency-Key": "clinical-request-retry"}

        async def expect(response, status):
            result = await response
            self.assertEqual(result.status_code, status, result.text)
            return result.json()

        first, replay = await asyncio.gather(
            expect(self.client.post(url, json=body, headers=headers), 201),
            expect(self.client.post(url, json=body, headers=headers), 201),
        )
        self.assertEqual(first["id"], replay["id"])
        await expect(self.client.post(url, json={**body, "question": "Different"}, headers=headers), 409)
        request_path = self.url + "/requests/" + first["id"]
        draft = f"{self.url}/cases/{case['id']}/report-draft-references"

        async def change(action, version, status=200, **fields):
            return await expect(self.client.patch(request_path, json={"action": action, "version": version, **fields}), status)

        await change("start", 1, 403)
        await login(self.client, outsider.organization, outsider.username)
        await expect(self.client.get(request_path), 403)
        await expect(self.client.get(f"/api/clinical/{outsider.organization}/requests/{first['id']}"), 404)
        await login(self.client, self.org, other.username)
        await expect(self.client.get(request_path), 404)
        await login(self.client, self.org, doctor.username)
        info = await expect(self.client.get(request_path), 200)
        self.assertEqual(info["actions"], ["start"])
        self.assertIsNone(info["case_id"])
        self.assertEqual((await expect(self.client.get(inbox), 200))["unread"], 1)
        notice = (await expect(self.client.get(inbox), 200))["items"][0]
        await expect(self.client.get(f"/api/worklist/{case['id']}"), 404)
        await expect(self.client.get(draft), 404)
        await change("assign", 1, 403, assignee_id=str(other.id))
        await change("start", 1)
        await change("start", 1, 409)
        await change("complete", 2, 422)
        await change("fail", 2, note="Temporary synthetic issue")
        await login(self.client, self.org, self.user.username)
        await expect(self.client.post(f"{inbox}/{notice['id']}/read"), 404)
        self.assertEqual(await expect(self.client.get(draft), 200), [])
        self.assertEqual((await expect(self.client.get(inbox), 200))["unread"], 2)
        self.assertEqual((await change("retry", 3))["status"], "open")
        await change("assign", 4, assignee_id=str(other.id))
        await login(self.client, self.org, doctor.username)
        await expect(self.client.get(request_path), 404)
        items = (await expect(self.client.get(inbox), 200))["items"]
        self.assertTrue(all(item["request_id"] is None for item in items))
        for _ in range(2):
            await expect(self.client.post(f"{inbox}/{notice['id']}/read"), 200)
        await login(self.client, self.org, other.username)
        await change("start", 5)
        await change("complete", 6, note="Synthetic response")
        await change("complete", 6, 409, note="Synthetic response")
        await login(self.client, self.org, self.user.username)
        references = await expect(self.client.get(draft), 200)
        self.assertEqual([(row["id"], row["result_note"]) for row in references], [(first["id"], "Synthetic response")])
        history = (await expect(self.client.get(request_path), 200))["history"]
        self.assertEqual([item["version"] for item in history], list(range(7, 0, -1)))

    async def test_advanced_worklist_filters_and_private_open_times(self):
        patient = await self.create("patients", {"display_name": "Synthetic Cohort", "local_reference": "LOCAL-19",
                                                "birth_date": "2006-10-01", "sex": "female"})
        case = await self.create("cases", {"case_number": "FILTER-A", "patient_id": patient["id"],
                                          "accessioned_at": "2024-10-04T15:15:00Z"})
        other = await self.create("cases", {"case_number": "FILTER-B", "patient_id": patient["id"]})
        earliest = await self.create("specimens", {"case_id": case["id"], "specimen_number": "SP-BIO",
                                                   "collection_date": "2024-09-30"})
        await self.create("specimens", {"case_id": case["id"], "specimen_number": "LATER", "collection_date": "2024-10-01"})
        await self.create("slides", {"specimen_id": earliest["id"], "slide_number": "S-QA"})
        identifier = await self.client.post(f"{self.url}/patients/{patient['id']}/external-identifiers", json={
            "system": "verified.test", "kind": "MRN", "value": "MRN-QA-19", "version": 1, "reason": "Synthetic linkage",
        })
        self.assertEqual(identifier.status_code, 200, identifier.text)
        doctor = await create_account(self.org, "filter-doctor", "doctor")
        assignment = await self.client.patch(f"{self.url}/cases/{case['id']}/assignment", json={
            "assignee_id": str(doctor.id), "version": 1, "reason": "Synthetic Worklist access",
        })
        self.assertEqual(assignment.status_code, 200, assignment.text)

        async def search(**filters):
            response = await self.client.post("/api/worklist/search", json=filters)
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        result = await search(q="FILTER-", patient_name="cohort", patient_id="mrn-qa", specimen="bio",
                              slide_id="s-qa", status="assigned", slide_state="missing_scan", sex="female",
                              age_max=17, date_from="2024-10-05", date_to="2024-10-05")
        self.assertEqual(result["total"], 1)
        row = result["rows"][0]
        self.assertEqual((row["age"], row["collection_date"], row["patient"]["number"]), (17, "2024-09-30", "MRN-QA-19"))
        self.assertEqual(row["mrns"], [{"value": "MRN-QA-19", "source": "verified.test"}])
        self.assertEqual(row["patient"]["localRef"], "LOCAL-19")
        self.assertEqual((await search(age_min=18))["total"], 0)
        self.assertEqual([row["record_id"] for row in (await search(q="FILTER-", age_data="missing"))["rows"]], [other["id"]])
        self.assertEqual((await self.client.post("/api/worklist/search", json={"age_min": 18, "age_max": 17})).status_code, 422)
        shared = await self.client.post("/api/worklist/views", json={
            "name": "Must be private", "visibility": "shared",
            "configuration": {"order": [{"field": "age", "direction": "asc"}], "filters": {"patient_id": "MRN-QA-19"}},
        })
        self.assertEqual(shared.status_code, 422)
        self.assertEqual((await self.client.post(f"/api/worklist/cases/{other['id']}/opened")).status_code, 200)
        await login(self.client, self.org, doctor.username)
        result = await search(q="FILTER-", opened="unopened", order=["age:asc"])
        self.assertEqual([row["record_id"] for row in result["rows"]], [case["id"]])
        self.assertEqual(result["counts"]["all"], 1)
        self.assertEqual(result["filtered_counts"]["registered"], 0)
        self.assertEqual((await self.client.post(f"/api/worklist/cases/{other['id']}/opened")).status_code, 404)
        self.assertEqual((await self.client.post(f"/api/worklist/cases/{case['id']}/opened")).status_code, 200)
        self.assertEqual((await search(opened="today"))["total"], 1)
        await login(self.client, self.org, self.user.username)
        self.assertEqual([row["record_id"] for row in (await search(opened="today"))["rows"]], [other["id"]])
        date_change = await self.client.patch(f"{self.url}/specimens/{earliest['id']}/collection-date",
                                             json={"version": 1, "collection_date": "2024-10-01"})
        self.assertEqual(date_change.status_code, 200, date_change.text)
        self.assertEqual((await search(age_min=18))["total"], 1)
        old_version = await self.client.patch(f"{self.url}/specimens/{earliest['id']}/collection-date",
                                             json={"version": 1, "collection_date": None})
        self.assertEqual(old_version.status_code, 409)

    async def test_workgroup_subscription_classification_and_workload_permissions(self):
        first = await create_account(self.org, "group-first", "doctor")
        second = await create_account(self.org, "group-second", "doctor")
        outside = await create_account(self.org + "-outside", "group-outsider", "admin")
        endpoint = "/api/worklist"
        roster = endpoint + "/workgroups/breast/members/"
        case = await self.create("cases", {"case_number": "GROUP-ONE"})
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "QA"})
        slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "QA"})
        for ext in ("ndpi", "svs"):
            sample = self.root / f"group.{ext}"
            sample.write_bytes(b"synthetic")
            await self.create("scans", {"slide_id": slide["id"], "storage_key": sample.name})
        classify = f"{self.url}/cases/{case['id']}/classification"
        assignment = f"{self.url}/cases/{case['id']}/assignment"

        async def expect(response, status):
            result = await response
            self.assertEqual(result.status_code, status, result.text)
            return result.json()

        async def change_role(account, version, member=True, status=200):
            return await expect(self.client.put(roster + str(account.id), json={"version": version, "member": member}), status)

        await change_role(outside, 0, status=404)
        roster_version = (await change_role(first, 0))["version"]
        await change_role(second, 0, status=409)
        roster_version = (await change_role(second, roster_version))["version"]
        classified = await expect(self.client.patch(classify, json={
            "version": 1, "group_key": "breast", "priority": "frozen", "reason": "Synthetic frozen routing",
        }), 200)
        self.assertEqual((classified["priority_source"], classified["status"]), ("manual", "registered"))
        active = await expect(self.client.patch(assignment, json={
            "version": 2, "assignee_id": str(first.id), "reason": "Synthetic assignment",
        }), 200)
        await change_role(first, roster_version, False, 409)
        review = await expect(self.client.patch(classify, json={
            "version": active["version"], "group_key": "cytology", "priority": "urgent", "reason": "Synthetic wrong group",
        }), 409)
        self.assertIn("not a member", review["detail"])
        excluded = await create_account(self.org, "group-excluded", "doctor")
        await expect(self.client.patch(assignment, json={
            "version": active["version"], "assignee_id": str(excluded.id), "reason": "Synthetic unauthorized assignment",
        }), 422)
        result = await expect(self.client.get(endpoint, params={"priority": "frozen", "group_key": "breast"}), 200)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["rows"][0]["group_name"], "Breast")
        self.assertEqual(result["workload"][0], {"assigned_to": str(first.id), "name": first.display_name,
            "cases": 1, "open_cases": 1, "in_review": 0, "completed": 0, "slides": 1, "frozen": 1})
        detail = await expect(self.client.get(endpoint + "/" + case["id"]), 200)
        audit = next(event for event in detail["audit"] if event["action"] == "classification_changed")
        self.assertIsNone(audit["before"]["priority"])
        self.assertEqual(audit["after"]["priority_source"], "manual")

        await login(self.client, self.org, first.username)
        subscription = endpoint + "/queues/breast/subscription"
        for _ in range(2):
            await expect(self.client.put(subscription, json={"subscribed": True}), 200)
        catalog = await expect(self.client.get(endpoint + "/queues"), 200)
        self.assertTrue(next(queue for queue in catalog if queue["key"] == "breast")["subscribed"])
        await expect(self.client.get(endpoint, params={"group_key": "cytology"}), 404)
        await expect(self.client.get(endpoint + "/workgroups"), 403)
        await login(self.client, self.org, second.username)
        result = await expect(self.client.get(endpoint, params={"group_key": "breast"}), 200)
        self.assertEqual((result["total"], result["workload"]), (0, []))
        await expect(self.client.get(endpoint + "/" + case["id"]), 404)
        await login(self.client, self.org, self.user.username)
        await expect(self.client.patch(assignment, json={
            "version": active["version"], "assignee_id": str(second.id), "reason": "Synthetic reassignment",
        }), 200)
        await change_role(first, roster_version, False)
        await login(self.client, self.org, first.username)
        catalog = await expect(self.client.get(endpoint + "/queues"), 200)
        self.assertNotIn("breast", {queue["key"] for queue in catalog})
        await expect(self.client.get(endpoint, params={"group_key": "breast"}), 404)
        await expect(self.client.put(subscription, json={"subscribed": True}), 404)

    async def test_case_editor_blocks_patient_match_label_and_quality(self):
        import io
        from PIL import Image

        patient = await self.create("patients", {"display_name": "Synthetic Intake", "local_reference": "QC-PATIENT"})
        case = await self.create("cases", {"case_number": "EDITOR-QA"})
        specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "QA"})
        other_specimen = await self.create("specimens", {"case_id": case["id"], "specimen_number": "OTHER"})
        slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "S1"})
        other_slide = await self.create("slides", {"specimen_id": specimen["id"], "slide_number": "S2"})
        source = self.root / "broken.ndpi"
        source.write_bytes(b"synthetic damaged scan")
        scan = await self.create("scans", {"slide_id": slide["id"], "storage_key": source.name})
        editor = self.url + "/editor"
        scan_url = editor + "/scans/" + scan["id"]
        slide_url = editor + "/slides/" + slide["id"]
        reason = "Synthetic QC verification"

        async def expect(response, status):
            result = await response
            self.assertEqual(result.status_code, status, result.text)
            return result

        response = await expect(self.client.post(editor + "/patients/match", json={"local_reference": "QC-PATIENT"}), 200)
        self.assertEqual(response.json()["id"], patient["id"])
        match = {"patient_id": patient["id"], "patient_version": 2, "version": 1, "reason": reason}
        await expect(self.client.patch(f"{editor}/cases/{case['id']}/patient-match", json=match), 409)
        await expect(self.client.patch(f"{editor}/cases/{case['id']}/patient-match",
                                       json={**match, "patient_version": 1}), 200)

        async def block_for(record):
            return (await expect(self.client.post(editor + f"/specimens/{record['id']}/blocks",
                json={"block_number": "B1", "version": 1, "reason": reason}), 201)).json()["id"]

        block = await block_for(specimen)
        wrong_block = await block_for(other_specimen)
        draft = {"slide_number": "S1", "stain": "HE", "block_id": block, "barcode": " abc-123 ", "version": 1, "reason": reason}
        await expect(self.client.patch(slide_url, json={**draft, "block_id": wrong_block}), 422)
        result = await expect(self.client.patch(slide_url, json=draft), 200)
        self.assertEqual(result.json()["barcode"], "ABC-123")
        await expect(self.client.patch(editor + "/slides/" + other_slide["id"], json={**draft, "slide_number": "S2"}), 409)

        await expect(self.client.get(scan_url + "/label.jpeg"), 422)
        await expect(self.client.put(scan_url + "/label?version=1", content=b"not an image"), 422)
        image = io.BytesIO()
        Image.new("RGB", (320, 90), "white").save(image, format="PNG")
        await expect(self.client.put(scan_url + "/label?version=1", content=image.getvalue()), 200)
        reply = await expect(self.client.get(scan_url + "/label.jpeg"), 200)
        self.assertEqual((reply.headers["content-type"], reply.headers["x-label-source"]), ("image/jpeg", "uploaded"))
        wsi_label = "/api/wsi/clinical/" + scan["id"] + "/label.jpeg"
        rendered = await expect(self.client.get(wsi_label), 200)
        self.assertEqual(rendered.headers["x-label-source"], "uploaded")
        self.assertEqual(rendered.headers["cache-control"], "private, no-store")
        self.assertEqual(rendered.content, reply.content)
        with patch("app.case_editor.recognize_label", return_value="ABC-123"):
            result = await expect(self.client.post(scan_url + "/ocr", json={"version": 2, "reason": reason}), 200)
        self.assertEqual(result.json()["candidate"], "ABC-123")
        self.assertIsNone((await self.client.get(f"{self.url}/slides/{slide['id']}")).json()["label_text"])
        confirmed = await expect(self.client.patch(slide_url, json={**draft, "version": 2, "label_text": "ABC-123",
            "confirmed_ocr_scan": scan["id"], "confirmed_ocr_version": 3}), 200)
        self.assertEqual(confirmed.json()["label_text"], "ABC-123")
        await expect(self.client.post(scan_url + "/qc", json={"version": 3, "source": "ai", "outcome": "hold", "reason": reason}), 422)
        result = await expect(self.client.post(scan_url + "/qc", json={"version": 3, "source": "ai", "outcome": "hold",
            "provider": "Synthetic model v1", "reference": "QA-001", "reason": reason}), 200)
        self.assertEqual(result.json()["qc_status"], "unassessed")
        await expect(self.client.post(scan_url + "/qc", json={"version": 4, "source": "manual", "outcome": "passed", "reason": reason}), 422)
        result = await expect(self.client.post(scan_url + "/check", json={"version": 4, "reason": reason}), 200)
        self.assertIn("error", result.json())
        await expect(self.client.post(scan_url + "/qc", json={"version": 5, "source": "manual", "outcome": "rescan_required", "reason": reason}), 200)
        await expect(self.client.get("/api/wsi/clinical/" + scan["id"]), 409)
        await expect(self.client.get(wsi_label), 409)
        result = await expect(self.client.get("/api/worklist", params={"slide_state": "qc_blocked"}), 200)
        self.assertEqual(result.json()["rows"][0]["slide_state"], ["missing_scan", "qc_blocked"])

        labeler = await create_account(self.org, "label-qa", "labeler")
        await login(self.client, self.org, labeler.username)
        await expect(self.client.post(scan_url + "/qc", json={"version": 6, "source": "scanner", "outcome": "passed",
            "provider": "Synthetic scanner", "reference": "QA-002", "reason": reason}), 403)
        doctor = await create_account(self.org, "editor-other", "doctor")
        await login(self.client, self.org, doctor.username)
        await expect(self.client.get(scan_url + "/label.jpeg"), 404)
        await expect(self.client.get(wsi_label), 404)
        await expect(self.client.get(editor + "/cases/" + case["id"]), 404)
