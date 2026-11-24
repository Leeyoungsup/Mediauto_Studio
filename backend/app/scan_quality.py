"""Bounded local image handling and optional OCR for scanned labels."""

import io
import os
import re
import shutil
import subprocess
from pathlib import Path

import openslide
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

BLOCKED_QC = ("hold", "rescan_required", "replaced")
MAX_LABEL_BYTES = 2 * 1024 * 1024


def encode_label(image):
    if image.width * image.height > 4_000_000:
        raise HTTPException(422, "The label image is too large.")
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((1400, 1400))
    result = io.BytesIO()
    image.save(result, format="JPEG", quality=91)
    return result.getvalue()


def uploaded_label(payload):
    try:
        with Image.open(io.BytesIO(payload), formats=["JPEG", "PNG"]) as image:
            return encode_label(image)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as exc:
        raise HTTPException(422, "Select a readable JPEG or PNG label image.") from exc


def embedded_label(path):
    try:
        with openslide.OpenSlide(path) as slide:
            label_name = next((name for name in slide.associated_images if name.casefold() == "label"), None)
            if label_name is None:
                raise HTTPException(404, "No embedded label image. Upload a label image or enter the text manually.")
            with slide.associated_images[label_name] as image:
                return encode_label(image)
    except (openslide.OpenSlideError, OSError, ValueError) as exc:
        raise HTTPException(422, "Unable to read the embedded scan label.") from exc


def inspect_scan(path):
    try:
        with openslide.OpenSlide(path) as slide:
            if slide.level_count < 1 or min(slide.dimensions) < 1:
                raise ValueError("invalid pyramid")
            width, height = slide.dimensions
            with slide.read_region((width // 2, height // 2), 0, (64, 64)):
                pass
            return {"dimensions": [width, height], "levels": slide.level_count,
                    "vendor": slide.properties.get("openslide.vendor")}
    except (openslide.OpenSlideError, OSError, ValueError) as exc:
        raise HTTPException(422, "The scan pyramid could not be opened or read.") from exc


def recognize_label(jpeg):
    executable = os.environ.get("MEDIAUTO_TESSERACT") or shutil.which("tesseract")
    if not executable:
        raise HTTPException(503, "Local OCR is unavailable. Enter the label text manually.")
    command = [executable, "stdin", "stdout", "-l", "eng", "--psm", "6"]
    packaged_data = Path(executable).resolve().parent.parent / "share" / "tessdata"
    if not os.environ.get("TESSDATA_PREFIX") and (packaged_data / "eng.traineddata").is_file():
        command.extend(("--tessdata-dir", str(packaged_data)))
    try:
        result = subprocess.run(command,
                                input=jpeg, capture_output=True, check=True, timeout=8)
    except (subprocess.SubprocessError, OSError) as exc:
        raise HTTPException(422, "OCR could not read the label. Retry or enter the text manually.") from exc
    text = re.sub(r"[\x00-\x1f]+", " ", result.stdout.decode("utf-8", errors="replace")).strip()
    if not text:
        raise HTTPException(422, "OCR found no label text. Enter the text manually.")
    return text[:500]
