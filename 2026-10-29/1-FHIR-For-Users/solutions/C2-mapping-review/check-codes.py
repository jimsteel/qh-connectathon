#!/usr/bin/env python3
"""C2 mapping review: check every code and value set claim in README.md / FHIR-Mapping-PROPOSED.md
against Ontoserver (r4.ontoserver.csiro.au, read-only). No patient data is sent.

    python3 check-codes.py > check-codes-output.txt
"""
import json
import urllib.parse
import urllib.request

TX = "https://r4.ontoserver.csiro.au/fhir"
SCT, LOINC = "http://snomed.info/sct", "http://loinc.org"
SPIA = "https://healthterminologies.gov.au/fhir/ValueSet/spia-pathology-reporting-1"
COND = "https://healthterminologies.gov.au/fhir/ValueSet/clinical-condition-1"
AUMED = "https://healthterminologies.gov.au/fhir/ValueSet/australian-medication-1"
fails = 0


def get(path, **params):
    url = f"{TX}/{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/fhir+json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        return {"error": e.code}


def check(label, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}  {detail}")


def lookup(system, code, expect_active=True):
    r = get("CodeSystem/$lookup", system=system, code=code, property="inactive")
    if "error" in r:
        check(f"{code} exists in {system}", not expect_active, f"HTTP {r['error']}")
        return
    p = r["parameter"]
    disp = next((x.get("valueString") for x in p if x["name"] == "display"), "")
    ver = next((x.get("valueString") for x in p if x["name"] == "version"), "")
    inactive = any(pp.get("valueBoolean") for x in p if x["name"] == "property" for pp in x["part"])
    check(f"{code} |{disp}| {'active' if expect_active else 'INACTIVE'}", inactive != expect_active, ver)


def in_vs(vs, system, code, expected=True):
    r = get("ValueSet/$validate-code", url=vs, system=system, code=code)
    res = next((x.get("valueBoolean") for x in r.get("parameter", []) if x["name"] == "result"), None)
    check(f"{code} {'in' if expected else 'NOT in'} {vs.split('/')[-1]}", res == expected)


def ecl(expr):
    r = get("ValueSet/$expand", url=f"{SCT}?fhir_vs=ecl/{expr}", count=200)
    return {c["code"]: c.get("display") for c in r.get("expansion", {}).get("contains", [])}


print("# Concepts used by the draft mapping, the synthetic data and the solutions\n")
for c in ["87522002", "35240004", "234340006", "234347009", "271737000", "707323002", "724556004",
          "1312141000168105", "1086251000168104", "430819007", "47625008", "3457005", "718520009",
          "409073007", "311401005", "708129006", "699054003", "699128009", "609588000", "52734007",
          "50172003", "359571009", "4558008", "116143008", "232717009", "26294005", "116863004",
          "62247001", "126242007", "256395009", "346447007", "256401009", "789265003", "714569001",
          "233568002", "438911000124105", "1156741008"]:
    lookup(SCT, c)
lookup(SCT, "103693007", expect_active=False)   # A4 Procedure.category 'Diagnostic procedure'
for c in ["718-7", "2276-4", "2502-3", "14801-5", "1988-5", "787-2", "14685-2", "14732-2",
          "62238-1", "98979-8", "8302-2", "29463-7", "39156-5"]:
    lookup(LOINC, c)

print("\n# AU Core bindings (extensible): pathology code -> RCPA SPIA reporting value set\n")
for c in ["718-7", "2276-4", "14801-5", "1988-5", "787-2", "14685-2", "14732-2", "62238-1", "98979-8"]:
    in_vs(SPIA, LOINC, c)
in_vs(SPIA, LOINC, "2502-3", expected=False)     # TSAT code used by data + every solution
in_vs(SPIA, LOINC, "2284-8", expected=False)     # mass folate: not SPIA

print("\n# AU Core Condition.code -> AU Clinical Condition (extensible)\n")
for c in ["87522002", "35240004", "234340006", "234347009", "271737000", "707323002", "724556004"]:
    in_vs(COND, SCT, c)

print("\n# AU Core MedicationRequest coding:amt -> Australian Medication (required)\n")
for c in ["1312141000168105", "1086251000168104", "430819007"]:
    in_vs(AUMED, SCT, c)

print("\n# Hierarchy facts the mapping relies on\n")
under_anaemia = ecl("(87522002 OR 234347009 OR 707323002 OR 35240004 OR 234340006) AND << 271737000")
check("87522002, 234347009, 707323002 are << 271737000 |Anaemia|",
      {"87522002", "234347009", "707323002"} <= set(under_anaemia))
check("35240004 and 234340006 are NOT << 271737000", not {"35240004", "234340006"} & set(under_anaemia))
under_id = ecl("<< 35240004")
check("<< 35240004 |Iron deficiency| has no descendants (IDA and 'without anaemia' are not under it)",
      set(under_id) == {"35240004"}, str(under_id))
check("311401005 |Patient education| << 409073007 |Education|", "311401005" in ecl("311401005 AND << 409073007"))

print("\n# IV iron value sets\n")
order_vs = ecl("(< 763158003 : 762949000 = (430077004 OR 1172494003), 411116001 = << 129011000036109) MINUS (* : 774158006 = *)")
check("A7 order ECL: 7 unbranded FCM / FDI injection products", len(order_vs) == 7, str(len(order_vs)))
check("both synthetic-data products are in the A7 order ECL",
      {"1312141000168105", "1086251000168104"} <= set(order_vs))
detect_vs = ecl("(< 763158003 : 762949000 = (430077004 OR 1172494003 OR 129497004 OR 708805001)) AND (< 763158003 : 411116001 = << 129011000036109)")
check("proposed IV iron *detection* ECL (FCM, FDI, iron sucrose, iron polymaltose; branded too)",
      {"1312141000168105", "1086251000168104", "23571011000036106", "23308011000036109"} <= set(detect_vs),
      f"{len(detect_vs)} concepts")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAIL(S)'}")
