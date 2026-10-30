#!/usr/bin/env python3
"""$validate every profiled resource in the referral seed against a HAPI server.

Usage: validate-referrals.py [FHIR_BASE]   (default http://127.0.0.1:18090/fhir)
The server must have the IG set loaded (see deploy/IG-PINNING.md). Exits 1 if anything other than the
known limitations below is reported.

Known limitations (the data is fine; the server lacks a package):
1. HAPI's built-in v2-0203 table lacks PGN and shadows the package copy, so Task groupIdentifier.type fails the
   'Order Identifier Type' binding. The HL7 validator accepts these bundles.
2. hl7.fhir.uv.ips (a dependency of AU eRequesting 1.0.1) is not installed (FETCHDEPENDENCIES=false), so the IPS
   pregnancy-status profile on Observation qhc-pregstatus-0013 cannot be found.
3. hl7.terminology.r4 (also a dependency) is not installed, so the CodeSystem coverage-selfpay is unknown and the valid
   code payconc on Coverage qhc-cov-13 is reported as unknown.
Fix for 2 and 3: install both packages on the referral server (needs a restart; after the event).
"""
import collections, glob, json, os, sys, urllib.error, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18090/fhir"
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "referrals")


def is_known(m):
    return (m.startswith("None of the codings provided are in the value set 'Order Identifier Type'")
            or ("http://hl7.org/fhir/uv/ips/StructureDefinition/" in m
                and ("could not be found" in m or "Failed to retrieve profile" in m))
            or m.startswith("Unknown code 'http://terminology.hl7.org/CodeSystem/coverage-selfpay#payconc'"))


errs, ok, known = collections.Counter(), 0, 0
files = [os.path.join(HERE, n) for n in ("00-referrers.json", "01-schedules-slots.json")]
files += sorted(glob.glob(os.path.join(HERE, "patient-*.json")))
for f in files:
    for e in json.load(open(f))["entry"]:
        r = e["resource"]
        if not r.get("meta", {}).get("profile"):
            continue
        req = urllib.request.Request("%s/%s/$validate" % (BASE, r["resourceType"]), data=json.dumps(r).encode(),
                                     headers={"Content-Type": "application/fhir+json"}, method="POST")
        try:
            out = json.load(urllib.request.urlopen(req, timeout=120))
        except urllib.error.HTTPError as x:
            out = json.load(x)
        es = [i.get("diagnostics") or str(i) for i in out["issue"] if i["severity"] in ("error", "fatal")]
        if not es:
            ok += 1
        elif all(is_known(m) for m in es):
            known += 1
        else:
            for m in es:
                if not is_known(m):
                    errs[(r["resourceType"], m[:200])] += 1
print("clean: %d, known-HAPI-limitation only: %d, other errors: %d kinds" % (ok, known, len(errs)))
for (t, m), n in errs.most_common():
    print(" %dx %s %s" % (n, t, m))
sys.exit(1 if errs else 0)
