"""Create explicitly synthetic, unassigned stain demo cases in a development IMS."""

import argparse
import asyncio
from datetime import datetime, timezone
import os
from pathlib import Path
import random
from tempfile import TemporaryDirectory

import numpy as np
import openslide
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
import tifffile

from app.database import database_url
from app.intake import DATA_ROOT, INTAKE_PREFIX, SlideFields, save_version, scan_files, slide_entries
from app.models import AuthUser, Case
from app.workflow import FileCase, confirm_file_case


ORGANIZATION = "local"
DEMO_FOLDER = "synthetic-stain-demo"
CASES = (
    ("DEMO-BREAST-001", "Synthetic breast specimen", ("H&E", "HER2", "ER", "PR", "Ki-67")),
    ("DEMO-GASTRIC-001", "Synthetic gastric specimen", ("H&E", "PD-L1")),
)


def make_slide(path: Path, slide_id: str, stain: str) -> None:
    description = f"Mediauto Synthetic Demo v1: {slide_id} {stain}"
    if path.is_symlink():
        raise RuntimeError("A synthetic demo path is a symbolic link.")
    if not path.exists():
        width, height = 1536, 1024
        image = Image.new("RGB", (width, height), "#faf8f2")
        draw = ImageDraw.Draw(image)
        draw.ellipse((120, 96, 1416, 930), fill="#e1accc" if stain == "H&E" else "#e9c8a5")
        rng = random.Random(slide_id)
        for _ in range(3400):
            x, y = rng.randrange(135, 1402), rng.randrange(110, 916)
            if ((x - 768) / 610) ** 2 + ((y - 512) / 385) ** 2 < 1:
                radius = rng.randrange(3, 10)
                palette = ("#9c518e", "#733b77", "#bf81ae") if stain == "H&E" else ("#a36139", "#75432d", "#c58d60")
                draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=rng.choice(palette))
        draw.text((30, 25), f"SYNTHETIC DEMO / {stain}", fill="#32213b", font=ImageFont.load_default(size=26))
        with TemporaryDirectory(dir=path.parent) as temporary:
            staged = Path(temporary) / "slide.tmp"
            with tifffile.TiffWriter(staged) as writer:
                for level in range(3):
                    layer = image.resize((width >> level, height >> level), Image.Resampling.LANCZOS)
                    writer.write(np.asarray(layer), photometric="rgb", tile=(256, 256), compression="deflate",
                                 subfiletype=int(level > 0), metadata=None, description=description if level == 0 else None)
            os.link(staged, path)
    with tifffile.TiffFile(path) as slide:
        if slide.pages[0].description != description:
            raise RuntimeError("An existing file does not match the synthetic demo.")
    with openslide.OpenSlide(str(path)) as slide:
        if slide.level_count != 3:
            raise RuntimeError("The synthetic slide must have three readable pyramid levels.")
        slide.read_region((0, 0), 0, (128, 128))


async def seed(username: str) -> None:
    url = database_url()
    if url.database not in ("mediauto_studio_dev", "mediauto_clinical_test"):
        raise RuntimeError("This script requires an IMS development or isolated test database.")
    engine = create_async_engine(url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as session:
            user = await session.scalar(select(AuthUser).where(
                AuthUser.organization == ORGANIZATION, AuthUser.username == username,
                AuthUser.active.is_(True), AuthUser.role == "admin",
            ))
            if user is None:
                raise RuntimeError("An active local administrator is required.")
            existing = set(await session.scalars(select(Case.case_number).where(
                Case.organization == ORGANIZATION, Case.case_number.in_([case[0] for case in CASES]),
            )))
        folder = DATA_ROOT / DEMO_FOLDER
        if folder.is_symlink():
            raise RuntimeError("The synthetic demo folder must not be a symbolic link.")
        folder.mkdir(mode=0o750, exist_ok=True)
        planned = {}
        for case_id, specimen, stains in CASES:
            if case_id in existing:
                print(f"{case_id}: already registered")
                continue
            for index, stain in enumerate(stains, start=1):
                slide_id = f"{case_id}-S{index:02d}"
                path = folder / f"{slide_id}.svs"
                make_slide(path, slide_id, stain)
                planned[path.relative_to(DATA_ROOT).as_posix()] = SlideFields(
                    case_id=case_id, slide_id=slide_id, specimen=specimen, stain=stain,
                )
        sources = [source for source in scan_files(DATA_ROOT) if source.filename in planned]
        if len(sources) != len(planned):
            raise RuntimeError("A generated slide is missing from the intake inventory.")
        confirmations = {}
        async with sessions.begin() as session:
            entries = await slide_entries(session, sources, lock=True)
            for source in sources:
                fields = planned[source.filename].model_dump()
                existing_entry = entries.get(source.id)
                if existing_entry is None:
                    await save_version(session, INTAKE_PREFIX + source.id, 0, {
                        "fields": fields, "source": "rule", "rule": "Synthetic Stain Demo",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                elif existing_entry["fields"] != fields:
                    raise RuntimeError("An existing intake entry for a demo slide differs from the fixture.")
                confirmations.setdefault(fields["case_id"], []).append({
                    "id": source.id, "version": existing_entry["version"] if existing_entry else 1,
                })
        for case_id, files in confirmations.items():
            async with sessions() as session:
                session.info["user"] = user
                await confirm_file_case(ORGANIZATION, case_id, FileCase(files=files), session)
            print(f"{case_id}: registered with {len(files)} synthetic scans")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user", default="admin1", help="Active local administrator used for recorded intake.")
    asyncio.run(seed(parser.parse_args().user))
