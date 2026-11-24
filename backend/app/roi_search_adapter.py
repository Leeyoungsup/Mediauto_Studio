"""Local development contract for image-only similarity retrieval."""

from dataclasses import dataclass
from io import BytesIO
from typing import Literal, Protocol

from PIL import Image


OrganSystem = Literal[
    "breast", "cardiovascular", "digestive", "endocrine", "genitourinary", "gynecologic",
    "head_neck", "hematolymphoid", "musculoskeletal", "nervous", "respiratory", "skin_soft_tissue", "other",
]
ORGAN_SYSTEMS = {
    "breast": "Breast",
    "cardiovascular": "Cardiovascular",
    "digestive": "Digestive",
    "endocrine": "Endocrine",
    "genitourinary": "Genitourinary",
    "gynecologic": "Gynecologic",
    "head_neck": "Head and Neck",
    "hematolymphoid": "Hematolymphoid",
    "musculoskeletal": "Musculoskeletal",
    "nervous": "Nervous System",
    "respiratory": "Respiratory",
    "skin_soft_tissue": "Skin and Soft Tissue",
    "other": "Other",
}


@dataclass(frozen=True)
class SearchReference:
    token: int
    signature: tuple[float, ...]


class SimilarityAdapter(Protocol):
    name: str

    def describe(self, png: bytes) -> tuple[float, ...]: ...

    def search(self, png: bytes, organ_system: OrganSystem, references: list[SearchReference],
               limit: int) -> list[int]: ...


class LocalDevelopmentAdapter:
    name = "Local Development · RGB Histogram v1"

    def describe(self, png):
        with Image.open(BytesIO(png)) as image, image.resize((32, 32), Image.Resampling.BOX) as sample:
            histogram = [0] * 64
            channels = iter(sample.tobytes())
            for red, green, blue in zip(channels, channels, channels, strict=True):
                histogram[(red // 64) * 16 + (green // 64) * 4 + blue // 64] += 1
        return tuple(value / 1024 for value in histogram)

    def search(self, png, organ_system, references, limit):
        # The scope layer filters the catalog by organ system before passing local references.
        query = self.describe(png)
        ranked = sorted(references, key=lambda item: (
            sum(abs(left - right) for left, right in zip(query, item.signature, strict=True)),
            item.token,
        ))
        return [item.token for item in ranked[:limit]]


ADAPTER: SimilarityAdapter = LocalDevelopmentAdapter()
