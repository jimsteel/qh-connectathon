#!/usr/bin/env python3
"""Prove a bundle change is additive: every value in OLD is still in NEW at the same path.

    python3 diff_bundles.py OLD.json NEW.json

Matches entries by request.url. Arrays are compared index by index (new items may only be
appended). An empty array in OLD that is absent in NEW counts as unchanged (FHIR JSON forbids
empty arrays; servers drop them on write). Prints every change and a summary of additions;
exits 1 if any existing value changed or an entry disappeared.
"""
import collections
import json
import re
import sys

old, new = (json.load(open(f)) for f in sys.argv[1:3])
old_e = {e["request"]["url"]: e for e in old["entry"]}
new_e = {e["request"]["url"]: e for e in new["entry"]}
changes, dropped_empty, added = [], [], collections.Counter()


def generic(path):
    """Observation/pam-001-hb-1.resource.code.coding[1] -> Observation.code.coding[]"""
    return re.sub(r"\[\d+\]", "[]", re.sub(r"^(\w+)/[^.]+(\.resource)?", r"\1", path))


def walk(a, b, path, rtype):
    if isinstance(a, dict):
        if not isinstance(b, dict):
            changes.append(f"{path}: {a!r} -> {b!r}"); return
        for k, v in a.items():
            if k not in b:
                if v == []:
                    dropped_empty.append(f"{path}.{k}")
                else:
                    changes.append(f"{path}.{k}: removed ({v!r})")
            else:
                walk(v, b[k], f"{path}.{k}", rtype)
        for k in b.keys() - a.keys():
            added[f"{generic(path)}.{k}"] += 1
    elif isinstance(a, list):
        if not isinstance(b, list) or len(b) < len(a):
            changes.append(f"{path}: {a!r} -> {b!r}"); return
        for i, v in enumerate(a):
            walk(v, b[i], f"{path}[{i}]", rtype)
        for i in range(len(a), len(b)):
            added[f"{generic(path)}[+]"] += 1
    elif a != b or type(a) is not type(b):
        changes.append(f"{path}: {a!r} -> {b!r}")


for url, e in old_e.items():
    if url not in new_e:
        changes.append(f"{url}: entry missing"); continue
    walk(e, new_e[url], url, url.split("/")[0])
for url in new_e.keys() - old_e.keys():
    added[f"new entry {url.split('/')[0]}"] += 1

print(f"{len(old_e)} old entries, {len(new_e)} new entries")
print(f"changed existing values: {len(changes)}")
for c in changes:
    print("  CHANGED", c)
print(f"empty arrays dropped (no data change): {len(dropped_empty)}")
for p, n in collections.Counter(generic(d) for d in dropped_empty).items():
    print(f"  {n:4d} x {p}")
print("additions (count x path):")
for k, n in sorted(added.items()):
    print(f"  {n:4d} x {k}")
sys.exit(1 if changes else 0)
