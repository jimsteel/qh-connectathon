#!/usr/bin/env python3
"""Build qld-postcode-centroids.js: a centroid (lat, lon) for every Queensland postal area.

Source: Australian Bureau of Statistics, ASGS Edition 3 (2021) Postal Areas (POA), via the ABS
ArcGIS REST service (https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0).
Licence: Creative Commons Attribution 4.0 International (ABS). No API key needed.

The service has no centroid output, so this fetches generalised polygons (about 1 km tolerance)
and computes the area-weighted centroid of each postal area's largest ring set.
Queensland postcodes are the ones starting with 4 (plus 9xxx PO-box ranges, which have no POA).

    python3 build-postcodes.py      # writes qld-postcode-centroids.js next to this file
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

URL = "https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0/query"


def fetch(offset):
    q = urllib.parse.urlencode({
        "where": "POA_CODE_2021 like '4%'", "outFields": "poa_code_2021", "returnGeometry": "true",
        "outSR": "4326", "maxAllowableOffset": "0.01", "geometryPrecision": "4",
        "resultOffset": offset, "resultRecordCount": 100, "orderByFields": "poa_code_2021", "f": "json",
    })
    with urllib.request.urlopen(f"{URL}?{q}", timeout=120) as r:
        return json.load(r)


def ring_centroid(ring):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if a == 0:
        return 0.0, ring[0][0], ring[0][1]
    return a / 2, cx / (3 * a), cy / (3 * a)


def centroid(rings):
    # Esri rings: outer rings clockwise (negative signed area here), holes anticlockwise; summing signed areas handles holes
    total = sx = sy = 0.0
    for ring in rings:
        a, x, y = ring_centroid(ring)
        total += a
        sx += a * x
        sy += a * y
    return sy / total, sx / total


out, offset = {}, 0
while True:
    page = fetch(offset)
    feats = page.get("features", [])
    for f in feats:
        code = f["attributes"]["poa_code_2021"]
        rings = f.get("geometry", {}).get("rings")
        if rings:
            lat, lon = centroid(rings)
            out[code] = [round(lat, 4), round(lon, 4)]
    if not page.get("exceededTransferLimit") and len(feats) < 100:
        break
    offset += len(feats)

path = Path(__file__).with_name("qld-postcode-centroids.js")
path.write_text(
    "// Queensland postal area centroids [lat, lon], computed by build-postcodes.py from\n"
    "// ABS ASGS 2021 Postal Areas (CC BY 4.0, https://www.abs.gov.au/statistics/standards/"
    "australian-statistical-geography-standard-asgs-edition-3). Approximate: for mapping only.\n"
    "window.QLD_POSTCODE_CENTROIDS = " + json.dumps(out, separators=(",", ":")) + ";\n")
print(f"{len(out)} postal areas -> {path.name}")
