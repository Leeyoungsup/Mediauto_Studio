"""Bounded decoding of untrusted PDF and photo uploads."""

import io
import re
import subprocess
import unicodedata
from urllib.parse import unquote

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

MIB = 1024 * 1024
FILE_LIMITS = {"pdf": 10 * MIB, "gross": 12 * MIB}
MIME_TYPES = {"pdf": "application/pdf", "gross": "image/jpeg"}
MAX_PAGES = 50
MAX_PHOTO_PIXELS = 24_000_000
PNG_HEADER = b"\x89PNG\r\n\x1a\n"


def upload_name(encoded, kind):
    value = unicodedata.normalize("NFC", unquote(encoded))
    value = value.replace("\\", "/").rsplit("/", 1)[-1]
    value = "".join(ch for ch in value if not unicodedata.category(ch).startswith("C")).strip()
    extension = ".pdf" if kind == "pdf" else ".jpg"
    stem = value.rsplit(".", 1)[0].strip(" .") if "." in value else value
    return (stem[:156] or ("document" if kind == "pdf" else "gross-image")) + extension


def poppler(command, args, content):
    try:
        result = subprocess.run(
            ["prlimit", "--as=805306368", "--cpu=8", "--", command, *args],
            input=content, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=9,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
        )
    except FileNotFoundError as error:
        raise HTTPException(503, "PDF processing is unavailable on this server.") from error
    except subprocess.TimeoutExpired as error:
        raise HTTPException(422, "This PDF exceeded the processing time limit.") from error
    if result.stderr.startswith(b"prlimit: failed to execute"):
        raise HTTPException(503, "PDF processing is unavailable on this server.")
    if result.returncode or b"Syntax Error" in result.stderr:
        raise HTTPException(422, "The PDF is damaged, encrypted, or too complex to process.")
    return result.stdout


def pdf_page(content, page):
    image = poppler("pdftoppm", ["-f", str(page), "-l", str(page), "-scale-to", "1500", "-singlefile", "-png", "-"], content)
    if not image.startswith(PNG_HEADER):
        raise HTTPException(422, "This PDF page could not be rendered.")
    return image


def photo_preview(content):
    try:
        with Image.open(io.BytesIO(content), formats=["JPEG"]) as image:
            image.thumbnail((1500, 1500), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=82)
            return output.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as error:
        raise HTTPException(422, "The gross image preview could not be rendered.") from error


def prepare_attachment(kind, content):
    if kind == "pdf":
        if not content.startswith(b"%PDF-"):
            raise HTTPException(415, "Select a PDF document.")
        info = poppler("pdfinfo", ["-"], content)
        pages = re.search(rb"^Pages:\s+(\d+)$", info, re.MULTILINE)
        if pages is None or not re.search(rb"^Encrypted:\s+no$", info, re.MULTILINE):
            raise HTTPException(422, "The PDF is damaged or encrypted.")
        count = int(pages[1])
        if not 1 <= count <= MAX_PAGES:
            raise HTTPException(422, "PDFs must have between 1 and 50 pages.")
        pdf_page(content, 1)
        return content, count

    if not (content.startswith(b"\xff\xd8\xff") or content.startswith(PNG_HEADER)):
        raise HTTPException(415, "Select a JPEG or PNG photograph.")
    try:
        with Image.open(io.BytesIO(content), formats=["JPEG", "PNG"]) as photo:
            if photo.width * photo.height > MAX_PHOTO_PIXELS or getattr(photo, "n_frames", 1) != 1:
                raise HTTPException(422, "Select a single photograph of up to 24 megapixels.")
            with ImageOps.exif_transpose(photo).convert("RGBA") as source, Image.new("RGB", source.size, "white") as rgb:
                with source.getchannel("A") as alpha:
                    rgb.paste(source, mask=alpha)
                output = io.BytesIO()
                rgb.save(output, format="JPEG", quality=95, subsampling=0)
                if output.tell() > FILE_LIMITS["gross"]:
                    raise HTTPException(413, "The processed gross image exceeds 12 MB.")
                return output.getvalue(), None
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as error:
        raise HTTPException(422, "The gross image is damaged or unreadable.") from error
