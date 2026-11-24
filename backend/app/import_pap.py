"""Import an immutable Pap screening export for one verified WSI."""

import argparse
from pathlib import Path

import openslide

from app.import_prostate import import_verified_archive
from app.intake import DATA_ROOT
from app.pdl1 import slide_signature
from app.pap_gallery import Archive, folder_for


def import_result(organization, slide_name, export):
    return import_verified_archive(organization, slide_name, export, DATA_ROOT, slide_signature, Archive, folder_for)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organization", required=True)
    parser.add_argument("--slide", required=True)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(import_result(args.organization, args.slide, args.result))
    except (ValueError, OSError, openslide.OpenSlideError) as error:
        parser.exit(1, f"Pap gallery import failed: {error}\n")


if __name__ == "__main__":
    main()
