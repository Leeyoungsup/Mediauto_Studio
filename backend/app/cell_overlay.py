"""Spatial rendering payloads. Diagnostic scoring stays in the model contracts."""

from collections import Counter

BUCKET = 2048
TILE_PAGE_SIZE = 5000


def density_grid(buckets, dimensions, point_for):
    step = 512
    while max(dimensions) > step * 256:
        step *= 2
    counts = Counter()
    for bucket in buckets.values():
        for entry in bucket:
            point = point_for(entry)
            if point is not None:
                x, y, grade = point[:3]
                counts[int(x) // step, int(y) // step, grade] += 1
    return {"step": step, "bins": [[bx * step, by * step, grade, count]
                                    for (bx, by, grade), count in counts.items()]}


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
