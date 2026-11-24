"""Attach an immutable prostate core/level export to an exact Level 0 WSI."""

import argparse
import hashlib
import os
import re
import tempfile
from pathlib import Path

import openslide

from app.intake import DATA_ROOT
from app.pdl1 import slide_signature
from app.prostate_results import Archive, MAX_ARCHIVE_BYTES, result_root


def import_result(organization, slide_name, export):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", organization):
        raise ValueError("Invalid institution code")
    slide = (DATA_ROOT.resolve() / slide_name).resolve(strict=True)
    if not slide.is_relative_to(DATA_ROOT.resolve()) or slide.suffix.lower() not in (".ndpi", ".svs"):
        raise ValueError("Select a registered NDPI or SVS under data/")
    if export.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Prostate AI export exceeds the size limit")
    raw = export.read_bytes()
    archive = Archive.model_validate_json(raw)
    signature = slide_signature(slide)
    if archive.source.model_dump(mode="json") != signature:
        raise ValueError("Export does not match the slide filename, size, quickhash and Level 0 dimensions")
    source_id = hashlib.sha256(raw).hexdigest()
    folder = result_root(organization, signature)
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = folder / (source_id + ".json")
    with tempfile.NamedTemporaryFile(dir=folder) as staging:
        staging.write(raw)
        staging.flush()
        try:
            os.link(staging.name, target)
        except FileExistsError:
            if target.read_bytes() != raw:
                raise ValueError("An existing archive does not match its digest") from None
    return source_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organization", required=True)
    parser.add_argument("--slide", required=True, help="Registered WSI path relative to data/")
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(import_result(args.organization, args.slide, args.result))
    except (ValueError, OSError, openslide.OpenSlideError) as error:
        parser.exit(1, f"Prostate AI import failed: {error}\n")


if __name__ == "__main__":
    main()
