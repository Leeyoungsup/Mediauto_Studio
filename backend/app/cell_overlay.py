"""Spatial rendering payloads. Diagnostic scoring stays in the model contracts."""

from array import array
import gzip
import sys

from fastapi import Request, Response

BUCKET = 2048
TILE_PAGE_SIZE = 5000


def packed_cells(buckets, point_for):
    """Encode each saved cell at its original coordinates in a little-endian float64 stream."""
    packed = array("d")
    for bucket in buckets.values():
        for entry in bucket:
            point = point_for(entry)
            if point is not None:
                packed.extend(point)
    if sys.byteorder != "little":
        packed.byteswap()
    return gzip.compress(packed.tobytes(), compresslevel=3, mtime=0)


def cell_buffer_response(request: Request, compressed: bytes, stride: int):
    encodings = {item.split(";", 1)[0].strip().lower(): item.partition(";")[2].strip().replace(" ", "")
                 for item in request.headers.get("accept-encoding", "").split(",")}
    use_gzip = "gzip" in encodings and encodings["gzip"] not in {"q=0", "q=0.0", "q=0.00", "q=0.000"}
    headers = {"Cache-Control": "private, no-store", "X-Cell-Stride": str(stride), "Vary": "Accept-Encoding"}
    if use_gzip:
        headers["Content-Encoding"] = "gzip"
    return Response(compressed if use_gzip else gzip.decompress(compressed),
                    media_type="application/octet-stream", headers=headers)


def tile_page(bucket, offset, point_for):
    points = []
    for index in range(offset, len(bucket)):
        point = point_for(bucket[index])
        if point is None:
            continue
        if len(points) == TILE_PAGE_SIZE:
            return {"points": points, "next_offset": index}
        points.append(point)
    return {"points": points, "next_offset": None}
