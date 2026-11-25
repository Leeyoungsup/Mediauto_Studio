"""Register copied, approved SaaS images with synthetic demo case metadata."""

import argparse
import asyncio
import filecmp
import fcntl
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import subprocess
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.clinical import add_event, relationship_state, scan_metadata
from app.database import database_url
from app.intake import DATA_ROOT
from app.models import AuthUser, Case, Patient, Slide, SlideScan, Specimen, WorklistView
from app.worklist_views import ViewCreate


SOURCE = Path("/mnt/hdd1/Mediauto-studio_saas/backend/uploads")
STAGING = DATA_ROOT.parent / ".runtime" / "saas-slide-import" / "projects"
DESTINATION = "saas-stain-demo"
ACTOR_SOURCE = "saas_demo_import"
ORGANIZATION = "local"
VIEW_NAME = "SaaS Stain Demo"
PROJECTS = {
    "HnE(BR)": ("TP", "EB"),
    "HnE(ST)": ("TP", "EB"),
    "IHC(ER,PR)": ("ER", "PR"),
    "IHC(HER2)": ("HR",),
    "IHC(KI-67)": ("KI",),
    "IHC(PD-L1)": ("PD",),
    "KP PD-L1(Breast)": ("PD",),
    "leica_pd-l1_st_mqkbqqym": ("PD",),
    "pd-l1_br_mssfc5z7": ("PD",),
}
STAINS = {"TP": "H&E", "EB": "H&E", "ER": "ER", "PR": "PR", "HR": "HER2", "KI": "Ki-67", "PD": "PD-L1"}
SLIDE_NAME = re.compile(r"((?:CODIPAI|WSI)-[A-Z]+-[A-Z]+-[0-9]+)-[IS]-([A-Z0-9]+)-[0-9]+")


def inventory():
    cases = defaultdict(lambda: defaultdict(list))
    unresolved = 0
    for project, codes in PROJECTS.items():
        directory = SOURCE / project
        if directory.is_symlink() or not directory.is_dir():
            raise RuntimeError("An expected source project is unavailable.")
        for source in sorted(directory.iterdir()):
            if source.suffix.lower() not in (".ndpi", ".svs") or source.is_symlink() or not source.is_file():
                continue
            match = SLIDE_NAME.fullmatch(source.stem.upper())
            if not match or match[2] not in codes:
                unresolved += 1
                continue
            cases[match[1]][(source.stem.upper(), STAINS[match[2]])].append(source.relative_to(SOURCE))
    return cases, unresolved


def ready(relative: Path) -> bool:
    source, staged = SOURCE / relative, STAGING / relative
    if not staged.is_file() or staged.resolve() != staged:
        return False
    original, copied = source.stat(), staged.stat()
    return (
        copied.st_size == original.st_size
        and copied.st_mtime_ns == original.st_mtime_ns
        and (copied.st_dev, copied.st_ino) != (original.st_dev, original.st_ino)
    )


def unique_scans(paths):
    scans = []
    for path in sorted(paths):
        if not any(
            path.suffix.lower() == prior.suffix.lower()
            and filecmp.cmp(STAGING / path, STAGING / prior, shallow=False)
            for prior in scans
        ):
            scans.append(path)
    return scans


def case_number(case_key: str) -> str:
    return "SAAS-DEMO-" + uuid5(NAMESPACE_URL, f"mediauto:saas-stain-demo:{case_key}").hex[:12].upper()


def copy_if_idle(cases):
    work = STAGING.parent
    STAGING.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (work / "copy.lock").open("ab") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        queue = work / "rsync-files.nul"
        with queue.open("wb") as listing:
            for slides in cases.values():
                for paths in slides.values():
                    for path in paths:
                        listing.write(os.fsencode(path) + b"\0")
        with (work / "rsync.log").open("ab") as log:
            subprocess.run(["rsync", "-rt", "--modify-window=-1", "--from0", f"--files-from={queue}",
                            "--partial-dir=.transfer", "--chmod=D700,F600", "--stats",
                            f"{SOURCE}/", f"{STAGING}/"], stdout=log, stderr=log, check=True)


async def publish(sessions, user, case_key, slides):
    number = case_number(case_key)
    linked = []
    try:
        async with sessions.begin() as session:
            session.info["user"] = user
            await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:number))"), {"number": number})
            existing = await session.scalar(select(Case).where(Case.organization == ORGANIZATION, Case.case_number == number))
            if existing is not None:
                return None
            tx = uuid4()

            async def create(model, **values):
                record = model(organization=ORGANIZATION, created_by=str(user.id), **values)
                session.add(record)
                await session.flush()
                add_event(session, record, "registered", {}, relationship_state(record),
                          source=ACTOR_SOURCE, transaction_id=tx)
                return record

            sequence = int(number.rsplit("-", 1)[1], 16)
            accession = datetime(2026, 1, 5, 9, tzinfo=timezone.utc) + timedelta(days=sequence % 300)
            patient = await create(Patient, display_name=f"Demo Patient {number[-6:]}",
                                   local_reference=f"DEMO-{number[-12:]}", source="synthetic_demo",
                                   birth_date=date(1955 + sequence % 40, 1, 1), sex=("female", "male")[sequence % 2])
            case = await create(Case, case_number=number, patient_id=patient.id, accessioned_at=accession)
            specimen = await create(Specimen, case_id=case.id, specimen_number="D1", description="Demo Specimen",
                                    collection_date=(accession - timedelta(days=1)).date())
            count = 0
            for slide_index, ((_, stain), paths) in enumerate(sorted(slides.items()), 1):
                label = f"D1-S{slide_index:02d}"
                slide = await create(Slide, slide_number=label, stain=stain, specimen_id=specimen.id, status="registered")
                for scan_index, path in enumerate(paths, 1):
                    relative = Path(DESTINATION) / number / f"{label}-{scan_index:02d}{path.suffix.lower()}"
                    destination = DATA_ROOT / relative
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    if not destination.parent.resolve().is_relative_to(DATA_ROOT.resolve()):
                        raise RuntimeError("Unexpected demo scan destination.")
                    staged = STAGING / path
                    try:
                        os.link(staged, destination)
                    except FileExistsError:
                        if destination.is_symlink() or not destination.samefile(staged):
                            raise RuntimeError("A demo scan destination is occupied by another file.") from None
                    else:
                        linked.append(destination)
                    await create(SlideScan, slide_id=slide.id, **scan_metadata(relative.as_posix()))
                    count += 1
        return count
    except BaseException:
        for path in linked:
            path.unlink(missing_ok=True)
        raise


async def ensure_view(sessions, user):
    columns = ["patient", "localPatientId", "specimen", "stains", "slides", "status", "assignee", "received", "source"]
    data = ViewCreate(name=VIEW_NAME, visibility="shared", configuration={
        "q": "SAAS-DEMO-", "order": [{"field": "case_number", "direction": "asc"}],
        "columns": [{"id": name, "visible": True} for name in columns],
    })
    async with sessions.begin() as session:
        await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:name))"), {"name": VIEW_NAME})
        existing = await session.scalar(select(WorklistView.id).where(
            WorklistView.organization == ORGANIZATION, WorklistView.name == VIEW_NAME, WorklistView.visibility == "shared",
        ).limit(1))
        if existing is None:
            session.add(WorklistView(organization=ORGANIZATION, owner_id=user.id, version=1, **data.model_dump(mode="json")))


async def run(username, apply):
    cases, unresolved = inventory()
    completed = {key: slides for key, slides in cases.items() if all(
        ready(path) for paths in slides.values() for path in paths
    )}
    print(f"Case groups: {len(cases)}; fully copied: {len(completed)}; unmatched files: {unresolved}.", flush=True)
    if not apply:
        return len(completed), len(cases)
    url = database_url()
    socket = STAGING.parents[1] / "pgsocket"
    if url.database != "mediauto_studio_dev" or Path(url.query.get("host", "")).resolve() != socket:
        raise RuntimeError("Registration requires this workspace's local IMS development database.")
    engine = create_async_engine(url, hide_parameters=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as session:
            user = await session.scalar(select(AuthUser).where(
                AuthUser.organization == ORGANIZATION, AuthUser.username == username,
                AuthUser.active.is_(True), AuthUser.role == "admin",
            ))
            if user is None:
                raise RuntimeError("An active local administrator is required.")
            registered = set(await session.scalars(select(Case.case_number).where(
                Case.organization == ORGANIZATION, Case.case_number.in_([case_number(key) for key in completed]),
            )))
        added = scans = 0
        for key, slides in sorted(completed.items()):
            if case_number(key) in registered:
                continue
            distinct = {slide: unique_scans(paths) for slide, paths in slides.items()}
            count = await publish(sessions, user, key, distinct)
            if count is not None:
                scans += count
                added += 1
        if completed:
            await ensure_view(sessions, user)
        print(f"Registered {added} new demo cases and {scans} scans; already registered: {len(registered)}.", flush=True)
    finally:
        await engine.dispose()
    return len(completed), len(cases)


async def watch(username):
    cases, unresolved = inventory()
    if unresolved:
        raise RuntimeError("Review unrecognized source filenames before starting a full transfer.")
    transfer = None
    while True:
        ready_count, total = await run(username, True)
        if ready_count == total:
            return
        if transfer is None or transfer.done():
            if transfer is not None:
                await transfer
            transfer = asyncio.create_task(asyncio.to_thread(copy_if_idle, cases))
        await asyncio.sleep(45)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user", default="admin1")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--apply-approved", action="store_true", help="Register only complete cases from the approved copies.")
    actions.add_argument("--watch-approved", action="store_true", help="Resume copying and register each completed case.")
    args = parser.parse_args()
    os.umask(0o077)
    asyncio.run(watch(args.user) if args.watch_approved else run(args.user, args.apply_approved))
