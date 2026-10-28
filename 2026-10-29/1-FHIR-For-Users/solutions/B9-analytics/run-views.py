#!/usr/bin/env python3
"""Run the SQL on FHIR ViewDefinitions (views/*.json) with Pathling over data/*.ndjson, then the KPI SQL.

    python run-views.py [period_start period_end]        # default FY 2025-26: 2025-07-01 2026-06-30

Needs Pathling (pip install pathling==10.0.0; Python 3.9+, Java 17+); see README for a throwaway venv.
Writes results/views/<view>.csv (the flat tables) and results/kpis/<kpi>.csv, and prints every KPI.
"""
import csv
import json
import os
import re
import sys
from pathlib import Path

from pathling import PathlingContext

HERE = Path(__file__).resolve().parent
period = sys.argv[1:3] if len(sys.argv) >= 3 else ["2025-07-01", "2026-06-30"]
(HERE / "results" / "views").mkdir(parents=True, exist_ok=True)
(HERE / "results" / "kpis").mkdir(parents=True, exist_ok=True)

# Spark downloads the Pathling jars (~140 MB) with Ivy; keep them out of ~/.ivy2 (PATHLING_IVY_DIR, default .cache/ivy here)
ivy = os.environ.get("PATHLING_IVY_DIR", str(HERE / ".cache" / "ivy"))
pc = PathlingContext.create(spark_conf={"spark.jars.ivy": ivy}, enable_terminology=False)
pc.spark.sparkContext.setLogLevel("ERROR")
data = pc.read.ndjson(str(HERE / "data"))
print(f"Pathling {pc.version()} on Spark {pc.spark.version}")


def write_csv(df, path):
    """Write a (small) DataFrame to CSV without pandas; return (columns, rows)."""
    rows = [[("" if v is None else v) for v in r] for r in df.collect()]
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(df.columns)
        w.writerows(rows)
    return df.columns, rows


def show(cols, rows):
    widths = [max(len(str(c)), *(len(str(r[i])) for r in rows)) if rows else len(str(c)) for i, c in enumerate(cols)]
    line = lambda vals: "  ".join(str(v).rjust(w) for v, w in zip(vals, widths))
    return "\n".join([line(cols)] + [line(r) for r in rows])


# 1. ViewDefinitions -> flat tables (Spark temp views named after the ViewDefinition)
for vd_path in sorted((HERE / "views").glob("*.json")):
    vd = json.loads(vd_path.read_text())
    df = data.view(json=vd_path.read_text())
    df.createOrReplaceTempView(vd["name"])
    cols, rows = write_csv(df, HERE / "results" / "views" / f"{vd['name']}.csv")
    print(f"view {vd['name']:22} {len(rows):4} rows  columns: {', '.join(cols)}")

# 2. KPI SQL: "-- view:" blocks become helper temp views, "-- name:" blocks are KPIs
sql = (HERE / "kpis.sql").read_text().replace("${period_start}", period[0]).replace("${period_end}", period[1])
blocks = re.split(r"^-- (view|name): *(\S+) *$", sql, flags=re.M)
print(f"\nKPIs for referrals from {period[0]} to {period[1]}")
for kind, name, body in zip(blocks[1::3], blocks[2::3], blocks[3::3]):
    stmt = body.strip().rstrip(";")
    df = pc.spark.sql(stmt)
    if kind == "view":
        df.createOrReplaceTempView(name)
        continue
    cols, rows = write_csv(df, HERE / "results" / "kpis" / f"{name}.csv")
    print(f"\n== {name}\n{show(cols, rows)}")

(HERE / "results" / "kpis" / "PERIOD.txt").write_text(f"{period[0]} {period[1]}\n")
pc.spark.stop()
