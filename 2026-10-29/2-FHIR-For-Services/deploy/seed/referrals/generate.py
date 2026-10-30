#!/usr/bin/env python3
"""Generate the fictional Track 2 referral seed bundles (deterministic output).

Usage: python3 generate.py   (writes *.json next to this script)
All people, organisations, identifiers and numbers are FICTIONAL.
"""
import json, os, datetime as dt

OUT = os.path.dirname(os.path.abspath(__file__))
SCT = "http://snomed.info/sct"
V2 = "http://terminology.hl7.org/CodeSystem/v2-0203"
AUV2 = "http://terminology.hl7.org.au/CodeSystem/v2-0203"
TAG = "http://terminology.hl7.org.au/CodeSystem/resource-tag"
TBS = "http://terminology.hl7.org.au/CodeSystem/task-business-status"
TCODE = "http://hl7.org/fhir/CodeSystem/task-code"
HPIO = "http://ns.electronichealth.net.au/id/hi/hpio/1.0"
HPII = "http://ns.electronichealth.net.au/id/hi/hpii/1.0"
IHI = "http://ns.electronichealth.net.au/id/hi/ihi/1.0"
MEDICARE = "http://ns.electronichealth.net.au/id/medicare-number"
MPN = "http://ns.electronichealth.net.au/id/medicare-provider-number"
P = "http://hl7.org.au/fhir/ereq/StructureDefinition/"
RR = "http://aehrc.csiro.au/fhir/radiology-referral/StructureDefinition/"
CORE = "http://hl7.org.au/fhir/core/StructureDefinition/"


def luhn(prefix):
    s = 0
    for i, ch in enumerate(reversed(prefix)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9: d -= 9
        s += d
    return prefix + str((10 - s % 10) % 10)


def hpio(n): return luhn("800362990000%03d" % n)       # synthetic: 8003629900 00nnn
def hpii(n): return luhn("800361990000%03d" % n)
def ihi(n):  return luhn("800360990000%03d" % n)


def medicare(n):
    base = "2999%04d" % n                                # synthetic: 2999 xxxx
    w = [1, 3, 7, 9, 1, 3, 7, 9]
    chk = sum(int(c) * k for c, k in zip(base, w)) % 10
    return base + str(chk) + "1" + "1"                   # check, issue no., IRN


def cc(system, code, display=None, text=None):
    c = {"system": system, "code": code}
    if display: c["display"] = display
    out = {"coding": [c]}
    if text: out["text"] = text
    return out


def ref(r, display=None):
    d = {"reference": r}
    if display: d["display"] = display
    return d


def bundle(entries):
    return {"resourceType": "Bundle", "type": "transaction", "entry": [
        {"fullUrl": "urn:uuid:" + r["resourceType"].lower() + "-" + r["id"], "resource": r,
         "request": {"method": "PUT", "url": r["resourceType"] + "/" + r["id"]}} for r in entries]}


def write(name, entries):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(bundle(entries), f, indent=2, ensure_ascii=False)
        f.write("\n")


# ---------------------------------------------------------------- fillers (directory side, referenced LOGICALLY)
# Fillers are taken from the directory seed (../directory/*.json) so every referral reference resolves there.
# filler number -> (directory org, directory location, {modality: directory HealthcareService number})
DIRSEED = os.path.join(OUT, "..", "directory")
FILLER_MAP = {
    1: ("01", "01", {"CT": "01", "MRI": "03", "US": "04", "XR": "02"}),   # Cairns
    2: ("04", "07", {"CT": "15", "MRI": "16"}),                           # Herston
    3: ("02", "03", {"CT": "08", "XR": "07", "MAM": "09"}),               # Rockhampton
    4: ("03", "05", {"MRI": "11"}),                                       # Toowoomba
    5: ("06", "10", {"CT": "22", "MRI": "23"}),                           # Southport
    6: ("05", "08", {"US": "19", "XR": "20"}),                            # Caboolture
}
# (old filler, modality) -> filler: the referral table below was drafted before the directory existed
REMAP = {(1, "CT"): 1, (1, "US"): 1, (1, "XR"): 1, (2, "CT"): 2, (2, "MRI"): 2, (2, "US"): 1,
         (3, "CT"): 5, (3, "MAM"): 3, (3, "MRI"): 5, (3, "XR"): 3, (4, "CT"): 5, (4, "US"): 6,
         (4, "XR"): 6, (6, "MRI"): 4}


def _dir(name):
    with open(os.path.join(DIRSEED, name)) as fh:
        return {e["resource"]["id"]: e["resource"] for e in json.load(fh)["entry"]}


_ORG, _LOC, _HCS = _dir("02-organizations.json"), _dir("03-locations.json"), _dir("04-healthcareservices.json")
SEED_SRC = "https://github.com/aehrc/qh-connectathon/id/track2-seed-source"


def _key(res):
    return [i["value"] for i in res["identifier"] if i["system"] == SEED_SRC][0]


FILLERS, FILLER_ORG, FILLER_LOC, FILLER_HCS = {}, {}, {}, {}
for _f, (_o, _l, _m) in FILLER_MAP.items():
    _org, _loc = _ORG["qhd-org-" + _o], _LOC["qhd-loc-" + _l]
    _hpio = [i["value"] for i in _org["identifier"] if i["system"] == HPIO][0]
    FILLERS[_f] = (_org["name"], _loc["address"]["city"].title(), _loc["address"]["postalCode"], _hpio, list(_m))
    FILLER_ORG[_f], FILLER_LOC[_f] = _org, _loc
    for _mod, _h in _m.items():
        assert _HCS["qhd-hcs-" + _h]["providedBy"]["reference"] == "Organization/qhd-org-" + _o
        assert _HCS["qhd-hcs-" + _h]["location"][0]["reference"] == "Location/qhd-loc-" + _l
        FILLER_HCS[(_f, _mod)] = _HCS["qhd-hcs-" + _h]
MOD = {  # modality -> (service type code, display, slot minutes)
    "CT": ("310128004", "Computed tomography service", 30),
    "MRI": ("310127009", "Magnetic resonance imaging service", 45),
    "US": ("310169008", "Ultrasound service", 30),
    "XR": ("310125001", "Radiology service", 15),
    "MAM": ("310125001", "Radiology service", 20),
}


def filler_org(f):
    n, _, _, h, _ = FILLERS[f]
    # literal reference (to the filler Organization on THIS server, see referrer_entries) plus the HPI-O: the UI's filler views
    # list organisations through Task?_include=Task:owner, which needs a resolvable reference, not just an identifier
    return {"reference": "Organization/qhc-org-fill%d" % f, "type": "Organization", "identifier": {"system": HPIO, "value": h}, "display": n}


def filler_hcs(f, m):
    # literal reference to the HealthcareService on THIS server (the booking screens search it by organisation and service
    # type and find Slots through it), plus the directory identifier it mirrors
    h = FILLER_HCS[(f, m)]
    return {"reference": "HealthcareService/qhc-hcs-f%d-%s" % (f, m.lower()), "type": "HealthcareService",
            "identifier": {"system": SEED_SRC, "value": _key(h)}, "display": h["name"]}


def filler_loc(f):
    loc = FILLER_LOC[f]
    return {"reference": "Location/qhc-loc-fill%d" % f, "type": "Location",
            "identifier": {"system": SEED_SRC, "value": _key(loc)}, "display": loc["name"]}


def svc_type(f, m):
    """Service type of the directory HealthcareService, so Schedule/Slot match the directory entry."""
    c = FILLER_HCS[(f, m)]["type"][0]["coding"][0]
    return cc(SCT, c["code"], c["display"])


# ---------------------------------------------------------------- referrers (live on the referral server)
REFERRERS = {
    1: ("Riverside Family Practice", "Brisbane", "4000", "8003621566684455", "0755505001",
        ("Alex", "Chen", 1, "Dr", "General practitioner", "62247001", "8003619900015717", "2426621B")),
    2: ("Wattle Grove Medical Centre", "Ipswich", "4305", hpio(2), "0755505002",
        ("Meera", "Joshi", 2, "Dr", "General practitioner", "62247001", None, "29990201")),
    3: ("Reef View Medical Practice", "Cairns", "4870", hpio(3), "0755505003",
        ("Liam", "O'Connell", 3, "Dr", "General practitioner", "62247001", None, "29990301")),
    4: ("Cane Valley Family Clinic", "Mackay", "4740", hpio(4), "0755505004",
        ("Beatrice", "Hartmann", 4, "Dr", "General practitioner", "62247001", None, "29990401")),
    5: ("Toowoomba Range Medical", "Toowoomba", "4350", hpio(5), "0755505005",
        ("Samuel", "Okoro", 5, "Dr", "General practitioner", "62247001", None, "29990501")),
    6: ("Bayside Community Hospital Outpatients", "Wynnum", "4178", hpio(6), "0755505006",
        ("Hannah", "Whitfield", 6, "Dr", "Physician", "309343006", None, "29990601")),
}


# ---------------------------------------------------------------- pathology laboratories (live on the referral server)
# Fictional pathology providers, for pathology requests (e.g. the eGFR behind contrast CT) and for participants to order
# against. Each lab has its pathologists linked via PractitionerRole.
# lab number -> (name, city, postcode, HPI-O, phone, [(given, family, HPI-I key, title, role display, role code, provider no.)])
PATHOLOGY = {
    1: ("Coral Coast Pathology", "Cairns", "4870", hpio(21), "0755505021",
        [("Rhiannon", "Petrakis", 21, "Dr", "General pathologist", "85733003", "29992101"),
         ("Tobias", "Wenzel", 22, "Dr", "Laboratory haematologist", "18850004", "29992201")]),
    2: ("Brigalow Pathology Laboratories", "Toowoomba", "4350", hpio(22), "0755505022",
        [("Anjali", "Deshmukh", 23, "Dr", "Medical biochemist", "28544002", "29992301"),
         ("Fergus", "Lachlan-Reid", 24, "Dr", "Anatomic pathologist", "83273008", "29992401")]),
    3: ("Moreton Clinical Pathology", "Bowen Hills", "4006", hpio(23), "0755505023",
        [("Selina", "Marchetti", 25, "Dr", "Clinical pathologist", "81464008", "29992501"),
         ("Kwame", "Asante", 26, "Dr", "Anatomic pathologist", "83273008", "29992601"),
         ("Yuki", "Harrington", 27, "Dr", "Laboratory haematologist", "18850004", "29992701")]),
    4: ("Fitzroy Valley Pathology", "Rockhampton", "4700", hpio(24), "0755505024",
        [("Declan", "Moorhouse", 28, "Dr", "General pathologist", "85733003", "29992801")]),
}


def pgn_system(r): return "http://ns.electronichealth.net.au/id/hpio-scoped/order/1.0/" + REFERRERS[r][3]


def referrer_entries():
    es = []
    for k, (name, city, pc, h, ph, gp) in REFERRERS.items():
        es.append({"resourceType": "Organization", "id": "qhc-org-ref%d" % k,
                   "meta": {"profile": [P + "au-erequesting-organization"]},
                   "identifier": [{"type": {"coding": [{"system": AUV2, "code": "NOI", "display": "National Organisation Identifier"}], "text": "HPI-O"},
                                   "system": HPIO, "value": h}],
                   "active": True, "name": name,
                   "telecom": [{"system": "phone", "value": ph}],
                   "address": [{"city": city, "state": "QLD", "postalCode": pc, "country": "AU"}]})
        given, fam, hn, pre, rdisp, rcode, hi, mpn = gp
        es.append({"resourceType": "Practitioner", "id": "qhc-prac-%d" % k,
                   "meta": {"profile": [P + "au-erequesting-practitioner"]},
                   "identifier": [{"type": {"coding": [{"system": V2, "code": "NPI", "display": "National provider identifier"}], "text": "HPI-I"},
                                   "system": HPII, "value": hi or hpii(k)}],
                   "name": [{"family": fam, "given": [given], "prefix": [pre]}]})
        es.append({"resourceType": "PractitionerRole", "id": "qhc-role-%d" % k,
                   "meta": {"profile": [P + "au-erequesting-practitionerrole"]},
                   "identifier": [{"type": {"coding": [{"system": AUV2, "code": "UPIN", "display": "Medicare Provider Number"}], "text": "Medicare Provider Number"},
                                   "system": MPN, "value": mpn}],
                   "practitioner": ref("Practitioner/qhc-prac-%d" % k, "%s %s %s" % (pre, given, fam)),
                   "organization": ref("Organization/qhc-org-ref%d" % k, name),
                   "code": [cc(SCT, rcode, rdisp)],
                   "telecom": [{"system": "phone", "value": ph}]})
    # Pathology laboratories, typed as pathology services, each with its pathologists (Practitioner + PractitionerRole)
    for k, (name, city, pc, h, ph, staff) in PATHOLOGY.items():
        es.append({"resourceType": "Organization", "id": "qhc-org-path%d" % k,
                   "meta": {"profile": [P + "au-erequesting-organization"]},
                   "identifier": [{"type": {"coding": [{"system": AUV2, "code": "NOI", "display": "National Organisation Identifier"}], "text": "HPI-O"},
                                   "system": HPIO, "value": h}],
                   "active": True, "name": name,
                   "type": [cc(SCT, "310074003", "Pathology service"),
                            cc("http://www.abs.gov.au/ausstats/abs@.nsf/mf/1292.0", "8520", "Pathology and Diagnostic Imaging Services", "Pathology laboratory")],
                   "telecom": [{"system": "phone", "value": ph}],
                   "address": [{"city": city, "state": "QLD", "postalCode": pc, "country": "AU"}]})
        for given, fam, hn, pre, rdisp, rcode, mpn in staff:
            es.append({"resourceType": "Practitioner", "id": "qhc-prac-path-%02d" % hn,
                       "meta": {"profile": [P + "au-erequesting-practitioner"]},
                       "identifier": [{"type": {"coding": [{"system": V2, "code": "NPI", "display": "National provider identifier"}], "text": "HPI-I"},
                                       "system": HPII, "value": hpii(hn)}],
                       "name": [{"family": fam, "given": [given], "prefix": [pre]}]})
            es.append({"resourceType": "PractitionerRole", "id": "qhc-role-path-%02d" % hn,
                       "meta": {"profile": [P + "au-erequesting-practitionerrole"]},
                       "identifier": [{"type": {"coding": [{"system": AUV2, "code": "UPIN", "display": "Medicare Provider Number"}], "text": "Medicare Provider Number"},
                                       "system": MPN, "value": mpn}],
                       "practitioner": ref("Practitioner/qhc-prac-path-%02d" % hn, "%s %s %s" % (pre, given, fam)),
                       "organization": ref("Organization/qhc-org-path%d" % k, name),
                       "code": [cc(SCT, rcode, rdisp)],
                       "telecom": [{"system": "phone", "value": ph}]})
    # The imaging providers (fillers) also exist HERE as Organizations, typed as diagnostic imaging, with the SAME HPI-O as in the
    # directory seed. The UI's "Select Provider Organisation" dropdown searches THIS server for Organization?type=<imaging codes>,
    # and a referral's performer/owner is a real Organization on this server. (The referral Tasks still point at the filler by HPI-O.)
    for f, (name, city, pc, h, mods) in FILLERS.items():
        es.append({"resourceType": "Organization", "id": "qhc-org-fill%d" % f,
                   "meta": {"profile": [P + "au-erequesting-organization"]},
                   "identifier": [{"type": {"coding": [{"system": AUV2, "code": "NOI", "display": "National Organisation Identifier"}], "text": "HPI-O"},
                                   "system": HPIO, "value": h}],
                   "active": True, "name": name,
                   "type": [cc(SCT, "708175003", "Diagnostic imaging service")],
                   "address": [{"city": city, "state": "QLD", "postalCode": pc, "country": "AU"}]})
        # ... with the Location and one HealthcareService per modality, copied from the directory seed (same names and service types),
        # because the app's booking screens expect them on THIS server: Location?organization (publish availability),
        # HealthcareService?organization&service-type (find the provider's service for a request), Slot?schedule.actor.
        loc = FILLER_LOC[f]
        a = loc.get("address", {})
        es.append({"resourceType": "Location", "id": "qhc-loc-fill%d" % f, "status": "active", "name": loc["name"],
                   "managingOrganization": ref("Organization/qhc-org-fill%d" % f, name),
                   "address": {"line": a.get("line", []), "city": a.get("city", city), "state": "QLD",
                               "postalCode": a.get("postalCode", pc), "country": "AU"}})
        for m in mods:
            h = FILLER_HCS[(f, m)]
            c = h["type"][0]["coding"][0]
            es.append({"resourceType": "HealthcareService", "id": "qhc-hcs-f%d-%s" % (f, m.lower()), "active": True,
                       "providedBy": ref("Organization/qhc-org-fill%d" % f, name),
                       "type": [cc(SCT, c["code"], c["display"])], "name": h["name"],
                       "location": [ref("Location/qhc-loc-fill%d" % f, loc["name"])]})
    return es


# ---------------------------------------------------------------- patients (fictional)
# (given, family, sex, dob, street, suburb, postcode, phone, indigenous-code)
PATIENTS = [
    ("Harold", "Mitchell-Voss", "male", "1958-02-11", "14 Wattle St", "Chermside", "4032", "0491570006", None),
    ("Priya", "Raghunathan", "female", "1984-07-30", "7 Bottlebrush Cl", "Ipswich", "4305", "0491570156", None),
    ("Tamika", "Cooper", "female", "1990-11-05", "22 Mulgrave Rd", "Cairns City", "4870", "0491570157", "1"),
    ("Giovanni", "Ferrante", "male", "1971-04-19", "3 Hartley St", "Edge Hill", "4870", "0491570158", None),
    ("Margaret", "O'Dwyer", "female", "1949-09-23", "91 Sugar Mill Rd", "Mackay", "4740", "0491570159", None),
    ("Ngoc Anh", "Tran", "female", "1977-01-14", "5 Margaret St", "Toowoomba City", "4350", "0491570110", None),
    ("Bruce", "Hollingworth", "male", "1963-12-02", "48 Ruthven St", "Toowoomba City", "4350", "0491570313", None),
    ("Aroha", "Kemp", "female", "2001-06-26", "17 Klingner Rd", "Redcliffe", "4020", "0491570737", None),
    ("Dmitri", "Volkov", "male", "1992-03-08", "60 Sandgate Rd", "Nundah", "4012", "0491570006", None),
    ("Chloe", "Nguyen", "female", "1996-10-17", "12 Redbank Plains Rd", "Redbank Plains", "4301", "0491570156", None),
    ("Kevin", "Patel", "male", "1980-05-29", "8 Cedar Rd", "Smithfield", "4878", "0491570157", None),
    ("Sandra", "Whitlock", "female", "1966-08-15", "33 Flinders St", "Townsville City", "4810", "0491570158", None),
    ("Darren", "Pascoe", "male", "1955-01-22", "26 Taylor St", "Harristown", "4350", "0491570159", None),
    ("Imogen", "Radcliffe", "female", "1988-02-02", "19 Oxford St", "Bulimba", "4171", "0491570110", None),
    ("Joseph", "Kaufusi", "male", "1974-11-11", "41 Wembley Rd", "Logan Central", "4114", "0491570313", None),
    ("Lila", "Sorensen", "female", "1999-09-09", "2 King St", "Caboolture", "4510", "0491570737", "4"),
    ("Ernest", "Maguire", "male", "1945-03-30", "70 Trinity Beach Rd", "Trinity Beach", "4879", "0491570006", None),
    ("Fatima", "Al-Rashid", "female", "1969-07-07", "15 Kirwan Dr", "Kirwan", "4817", "0491570156", None),
    ("Callum", "Brennan", "male", "1983-12-25", "9 Kearneys Spring Rd", "Kearneys Spring", "4350", "0491570157", None),
    ("Yolanda", "Ibarra", "female", "1991-04-04", "28 Bay Terrace", "Wynnum", "4178", "0491570158", None),
]
INDIG = {"1": "Aboriginal but not Torres Strait Islander origin", "4": "Neither Aboriginal nor Torres Strait Islander origin"}


def patient(i):
    g, f, sex, dob, st, sub, pc, ph, ind = PATIENTS[i - 1]
    r = {"resourceType": "Patient", "id": "qhc-pat-%02d" % i,
         "meta": {"profile": [CORE + "au-core-patient", P + "au-erequesting-patient"]}}
    if ind:
        r["extension"] = [{"url": "http://hl7.org.au/fhir/StructureDefinition/indigenous-status",
                           "valueCoding": {"system": "https://healthterminologies.gov.au/fhir/CodeSystem/australian-indigenous-status-1",
                                           "code": ind, "display": INDIG[ind]}}]
    r["identifier"] = [
        {"type": {"coding": [{"system": V2, "code": "NI"}], "text": "IHI"}, "system": IHI, "value": ihi(i)},
        {"type": {"coding": [{"system": V2, "code": "MC", "display": "Patient's Medicare Number"}], "text": "Medicare Number"},
         "system": MEDICARE, "value": medicare(i)}]
    r["name"] = [{"use": "usual", "family": f, "given": g.split(" ")[:1] if False else [g]}]
    r["telecom"] = [{"system": "phone", "value": ph, "use": "mobile"}]
    r["gender"] = sex
    r["birthDate"] = dob
    r["address"] = [{"use": "home", "line": [st], "city": sub, "state": "QLD", "postalCode": pc, "country": "AU"}]
    return r


# ---------------------------------------------------------------- referral storylines
PROC = {  # key -> (code, display, modality, contrast)
    "CTAP": ("432370003", "CT of abdomen and pelvis with contrast", "CT", True),
    "CTHEAD": ("303653007", "CT of head", "CT", False),
    "CTCHEST": ("169069000", "CT of chest", "CT", False),
    "CTSINUS": ("241526005", "CT of paranasal sinuses", "CT", False),
    "MRLS": ("241648005", "MRI of lumbar spine", "MRI", False),
    "MRKNEE": ("241641004", "MRI of knee", "MRI", False),
    "MRBRAIN": ("816077007", "MRI of brain", "MRI", False),
    "USABD": ("45036003", "Ultrasound of abdomen", "US", False),
    "USTHY": ("433175006", "Ultrasound of thyroid and parathyroid", "US", False),
    "USPEL": ("24848001", "Ultrasound scan of pelvis", "US", False),
    "XRCHEST": ("399208008", "Plain chest X-ray", "XR", False),
    "XRLS": ("840361000", "Plain X-ray of lumbar spine", "XR", False),
    "XRSHO": ("783543007", "Plain X-ray of shoulder", "XR", False),
    "MAM": ("24623002", "Screening mammography", "MAM", False),
}
REASON = {
    "ruq": ("301717006", "Right upper quadrant pain"), "abd": ("21522001", "Abdominal pain"),
    "back": ("161891005", "Back pain"), "head": ("25064002", "Headache"),
    "knee": ("1003722009", "Pain of knee region"), "sho": ("45326000", "Shoulder pain"),
    "cough": ("49727002", "Cough"), "goitre": ("3716002", "Goitre"),
    "dysp": ("267036007", "Dyspnea"), "sinus": ("40055000", "Chronic sinusitis"),
    "pelvic": ("30473006", "Pain in pelvis"), "screen": None,
}
# state: req/rec/acc = active, no booking; book = active + booked appt; done = completed; donebk = completed + fulfilled appt
# (n, patient, referrer, filler, proc, reason, priority, state, authoredOn, appointment date, condition?)
REFERRALS = [
    (1, 1, 1, 1, "CTAP", "ruq", "routine", "req", "2026-10-14", None, True),
    (2, 2, 2, 1, "USABD", "abd", "routine", "req", "2026-10-15", None, False),
    (3, 3, 3, 2, "MRLS", "back", "routine", "rec", "2026-10-12", None, True),
    (4, 4, 3, 2, "CTHEAD", "head", "urgent", "acc", "2026-10-16", None, False),
    (5, 5, 4, 3, "MRKNEE", "knee", "routine", "donebk", "2026-09-08", "2026-09-22", True),
    (6, 5, 4, 3, "XRSHO", "sho", "routine", "req", "2026-10-17", None, False),
    (7, 6, 5, 4, "CTCHEST", "cough", "routine", "book", "2026-10-09", "2026-11-02", True),
    (8, 7, 5, 4, "USTHY", "goitre", "routine", "done", "2026-09-15", None, False),
    (9, 8, 6, 1, "XRCHEST", "dysp", "urgent", "donebk", "2026-09-30", "2026-10-02", False),
    (10, 9, 1, 1, "CTSINUS", "sinus", "routine", "req", "2026-10-18", None, False),
    (11, 10, 2, 1, "USPEL", "pelvic", "routine", "acc", "2026-10-13", None, False),
    (12, 11, 3, 2, "MRBRAIN", "head", "routine", "book", "2026-10-08", "2026-11-03", True),
    (13, 12, 4, 3, "MAM", "screen", "routine", "donebk", "2026-09-01", "2026-09-18", False),
    (14, 13, 5, 4, "XRLS", "back", "routine", "donebk", "2026-08-12", "2026-08-20", False),
    (15, 13, 5, 4, "USABD", "abd", "routine", "rec", "2026-10-17", None, False),
    (16, 14, 6, 1, "CTAP", "abd", "urgent", "donebk", "2026-09-22", "2026-09-25", True),
    (17, 15, 2, 1, "XRSHO", "sho", "routine", "done", "2026-09-10", None, False),
    (18, 16, 2, 6, "MRKNEE", "knee", "routine", "req", "2026-10-19", None, False),
    (19, 17, 3, 2, "USABD", "abd", "routine", "donebk", "2026-10-01", "2026-10-06", False),
    (20, 18, 4, 3, "CTHEAD", "head", "routine", "done", "2026-09-24", None, False),
    (21, 19, 5, 4, "CTCHEST", "cough", "urgent", "req", "2026-10-18", None, False),
    (22, 20, 6, 1, "USABD", "abd", "routine", "book", "2026-10-07", "2026-11-02", False),
]
REFERRALS = [r[:3] + (REMAP[(r[3], PROC[r[4]][2])],) + r[4:] for r in REFERRALS]  # fillers now come from the directory seed
TASKSTATUS = {"req": "requested", "rec": "received", "acc": "accepted", "book": "in-progress", "done": "completed", "donebk": "completed"}


def tz(d, hh=9, mm=0): return "%sT%02d:%02d:00+10:00" % (d, hh, mm)


def slot_id(f, m, day, hh, mm): return "qhc-slot-f%d-%s-%s-%02d%02d" % (f, m.lower(), day.replace("-", ""), hh, mm)


def sched_id(f, m): return "qhc-sched-f%d-%s" % (f, m.lower())


def end_time(day, hh, mm, mins):
    t = dt.datetime.strptime("%s %02d:%02d" % (day, hh, mm), "%Y-%m-%d %H:%M") + dt.timedelta(minutes=mins)
    return t.strftime("%Y-%m-%dT%H:%M:00+10:00")




def appt_time(state): return (8, 0) if state == "book" else (9, 0)


def referral_entries(row):
    n, pi, rf, f, pk, rk, prio, state, auth, apday, cond = row
    code, disp, mod, contrast = PROC[pk]
    st = MOD[mod]
    pid = "Patient/qhc-pat-%02d" % pi
    role = "PractitionerRole/qhc-role-%d" % rf
    rdisp = "%s %s" % (REFERRERS[rf][5][3], REFERRERS[rf][5][1])
    pgn = "RFP-QHC-%04d" % n
    sysn = pgn_system(rf)
    assigner = ref("Organization/qhc-org-ref%d" % rf, REFERRERS[rf][0])
    sr_id, tk_id, gt_id = "qhc-sr-%04d" % n, "qhc-task-%04d" % n, "qhc-taskgroup-%04d" % n
    es = []
    reason = REASON[rk]
    cond_id = None
    if cond and reason:
        cond_id = "qhc-cond-%04d" % n
        es.append({"resourceType": "Condition", "id": cond_id, "meta": {"profile": [CORE + "au-core-condition"]},
                   "clinicalStatus": cc("http://terminology.hl7.org/CodeSystem/condition-clinical", "active"),
                   "category": [cc("http://terminology.hl7.org/CodeSystem/condition-category", "problem-list-item")],
                   "code": cc(SCT, reason[0], reason[1]), "subject": ref(pid),
                   "onsetDateTime": (dt.date.fromisoformat(auth) - dt.timedelta(days=14)).isoformat()})
    egfr_id = None
    if contrast:
        egfr_id = "qhc-egfr-%04d" % n
        es.append({"resourceType": "Observation", "id": egfr_id, "status": "final",
                   "category": [cc("http://terminology.hl7.org/CodeSystem/observation-category", "laboratory")],
                   "code": cc("http://loinc.org", "98979-8", "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI 2021)/1.73 sq M"),
                   "subject": ref(pid),
                   "effectiveDateTime": (dt.date.fromisoformat(auth) - dt.timedelta(days=3)).isoformat(),
                   "valueQuantity": {"value": 60 + (n * 7) % 35, "unit": "mL/min/{1.73_m2}", "system": "http://unitsofmeasure.org", "code": "mL/min/{1.73_m2}"}})
    completed = state in ("done", "donebk")
    sr = {"resourceType": "ServiceRequest", "id": sr_id, "meta": {"profile": [RR + "referral-servicerequest"]},
          "identifier": [{"system": sysn, "value": pgn + "-1"}],
          "requisition": {"type": {"coding": [{"system": V2, "code": "PGN"}]}, "system": sysn, "value": pgn},
          "status": "completed" if completed else "active", "intent": "order",
          "category": [cc(SCT, "3457005", "Patient referral"), cc(SCT, "363679005", "Imaging")],
          "priority": prio,
          "code": {"coding": [{"system": SCT, "code": code, "display": disp}], "text": disp},
          "subject": ref(pid),
          "occurrencePeriod": {"start": auth, "end": (dt.date.fromisoformat(auth) + dt.timedelta(days=14 if prio == "routine" else 3)).isoformat()},
          "authoredOn": tz(auth, 10, 15),
          "requester": ref(role, rdisp),
          "performerType": cc(SCT, st[0], st[1]),
          "performer": [filler_org(f)]}
    if reason:
        sr["reasonCode"] = [cc(SCT, reason[0], reason[1])]
    if cond_id:
        sr["reasonReference"] = [ref("Condition/" + cond_id)]
    if egfr_id:
        sr["supportingInfo"] = [ref("Observation/" + egfr_id)]
        sr["note"] = [{"text": "No known allergy to iodinated contrast. eGFR attached."}]
    elif prio == "urgent":
        sr["note"] = [{"text": "Urgent - please triage same day."}]
    es.append(sr)
    last = tz(auth, 14, 0) if state == "req" else tz((dt.date.fromisoformat(auth) + dt.timedelta(days=1)).isoformat(), 9, 0)
    if completed:
        last = tz(apday or (dt.date.fromisoformat(auth) + dt.timedelta(days=9)).isoformat(), 16, 30)
    gstatus = TASKSTATUS[state]
    biz = {"book": "service-booked", "done": "image-acquired", "donebk": "image-acquired"}.get(state)
    common_group_id = {"type": {"coding": [{"system": V2, "code": "PGN"}], "text": "Placer Group Number"}, "system": sysn, "value": pgn, "assigner": assigner}

    def task(rid, profile, tagcode):
        t = {"resourceType": "Task", "id": rid, "meta": {"profile": [profile], "tag": [{"system": TAG, "code": tagcode}]}}
        return t
    gt = task(gt_id, P + "au-erequesting-task-group", "fulfilment-task-group")
    gt.update({"groupIdentifier": common_group_id, "status": gstatus})
    tk = task(tk_id, RR + "referral-task", "fulfilment-task")
    tk.update({"identifier": [{"type": {"coding": [{"system": V2, "code": "PLAC", "display": "Placer Identifier"}]},
                               "system": sysn, "value": pgn + "-1", "assigner": assigner}],
               "groupIdentifier": common_group_id, "partOf": [ref("Task/" + gt_id)], "status": gstatus})
    for t in (gt, tk):
        if biz: t["businessStatus"] = cc(TBS, biz)
        t.update({"intent": "order", "priority": prio, "code": cc(TCODE, "fulfill"), "for": ref(pid),
                  "authoredOn": tz(auth, 10, 15), "lastModified": last, "requester": ref(role, rdisp),
                  "owner": filler_org(f)})
    tk["focus"] = ref("ServiceRequest/" + sr_id)
    es += [gt, tk]
    if apday:
        hh, mm = appt_time(state)
        sid = slot_id(f, mod, apday, hh, mm)
        booked = state == "book"
        ap = {"resourceType": "Appointment", "id": "qhc-appt-%04d" % n, "meta": {"profile": [RR + "referral-appointment"]},
              "status": "booked" if booked else "fulfilled",
              "serviceType": [svc_type(f, mod)],
              "start": tz(apday, hh, mm), "end": end_time(apday, hh, mm, st[2]),
              "created": (dt.date.fromisoformat(auth) + dt.timedelta(days=1)).isoformat(),
              "slot": [ref("Slot/" + sid)], "basedOn": [ref("ServiceRequest/" + sr_id)],
              "patientInstruction": "Please arrive 15 minutes early and bring your Medicare card." + (" Fast for 4 hours before your scan." if contrast else ""),
              "participant": [{"actor": ref(pid), "status": "accepted"},
                              {"actor": filler_loc(f), "status": "accepted"},
                              {"actor": filler_hcs(f, mod), "status": "accepted"}]}
        if cond_id: ap["reasonReference"] = [ref("Condition/" + cond_id)]
        es.append(ap)
    return es


def schedules_and_slots():
    es = []
    # one schedule per (filler, modality) offered, so participants can browse any of them
    for f, (name, city, pc, h, mods) in FILLERS.items():
        for m in mods:
            st = MOD[m]
            sid = sched_id(f, m)
            es.append({"resourceType": "Schedule", "id": sid, "meta": {"profile": [RR + "booking-schedule"]},
                       "active": True, "serviceType": [svc_type(f, m)],
                       "actor": [filler_hcs(f, m), filler_loc(f)],
                       "planningHorizon": {"start": "2026-08-01T00:00:00+10:00", "end": "2026-12-31T23:59:59+10:00"}})
            # free slots: two days, 3 each  (08:00 is reserved for the pre-booked demo appointments)
            for day in ("2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"):
                for hh, mm in ((9, 0), (9, 45), (10, 30)):
                    es.append(_slot(f, m, day, hh, mm, "free"))
    # busy slots backing appointments
    for r in REFERRALS:
        n, pi, rf, f, pk, rk, prio, state, auth, apday, cond = r
        if apday:
            hh, mm = appt_time(state)
            es.append(_slot(f, PROC[pk][2], apday, hh, mm, "busy"))
    return es


def _slot(f, m, day, hh, mm, status):
    st = MOD[m]
    return {"resourceType": "Slot", "id": slot_id(f, m, day, hh, mm), "meta": {"profile": [RR + "booking-slot"]},
            "serviceType": [svc_type(f, m)], "schedule": ref("Schedule/" + sched_id(f, m)),
            "status": status, "start": tz(day, hh, mm), "end": end_time(day, hh, mm, st[2])}


# ---------------------------------------------------------------- pathology requests (AU eRequesting 1.0.1)
# One order = Encounter + one au-erequesting-servicerequest-path per test (shared PGN, displaySequence = position on the
# form) + a Group Task + one Diagnostic Request Task per test, owned by the pathology lab. Test codes are from the
# RCPA SPIA requesting refset (the binding on ServiceRequest.code); code.text is the form wording.
PATH_TESTS = {  # key -> (SNOMED code, display, text on form, fasting required)
    "FBC": ("26604007", "Full blood count", "FBC", False),
    "UEC": ("444164000", "Urea, electrolytes and creatinine measurement", "UEC", False),
    "LFT": ("26958001", "Liver function test", "LFT", False),
    "HBA1C": ("43396009", "Haemoglobin A1c measurement", "HbA1c", False),
    "LIPID": ("252150008", "Fasting lipid profile", "Lipids (fasting)", True),
    "FBG": ("271062006", "Fasting blood glucose measurement", "Glucose, fasting", True),
    "TSH": ("313440008", "Serum TSH measurement", "TSH", False),
    "INR": ("440685005", "Calculation of international normalised ratio", "INR", False),
    "FERR": ("269821003", "Serum ferritin measurement", "Ferritin", False),
    "B12": ("271216009", "Serum vitamin B12 measurement", "Vitamin B12", False),
    "CRP": ("55235003", "C-reactive protein measurement", "CRP", False),
    "TROP": ("105000003", "Troponin measurement", "Troponin", False),
    "MSU": ("401324008", "Urine microscopy, culture and sensitivities", "Urine MCS", False),
    "PSA": ("63476009", "Prostate specific antigen measurement", "PSA", False),
    "GRPAB": ("252315008", "Blood group antibody screening", "Group and antibody screen", False),
    "RUB": ("313670007", "Rubella IgG measurement", "Rubella IgG", False),
    "HBSAG": ("47758006", "Hepatitis B surface antigen measurement", "Hepatitis B sAg", False),
}
PATH_REASON = {
    "fatigue": ("84229001", "Fatigue"), "t2dm": ("44054006", "Type 2 diabetes mellitus"),
    "hypothyroid": ("40930008", "Hypothyroidism"), "chest": ("29857009", "Chest pain"),
    "af": ("49436004", "Atrial fibrillation"), "dysuria": ("49650001", "Dysuria"),
    "preg": ("72892002", "Normal pregnancy"), "lipid": ("55822004", "Hyperlipidaemia"), None: None,
}
# state -> (Task.status, Task.businessStatus, ServiceRequest.status)
PATH_STATE = {
    "req": ("requested", None, "active"), "rec": ("received", None, "active"), "acc": ("accepted", None, "active"),
    "coll": ("in-progress", "specimen-collected", "active"), "lab": ("in-progress", "pathology-in-lab", "active"),
    "prelim": ("in-progress", "preliminary-results", "active"), "done": ("completed", None, "completed"),
    "hold": ("on-hold", None, "on-hold"), "cancel": ("cancelled", "request-cancelled-placer", "revoked"),
    "reject": ("rejected", "request-data-issue", "active"),
}
# coverage: None = bulk-billed Medicare (no Coverage resource, as in the IG examples), or "dva" / "conc" / "private"
# (n, patient, referrer, lab, tests, priority, state, authoredOn, reason, coverage, note)
PATH_REQUESTS = [
    (1, 1, 1, 3, ["FBC", "UEC", "LFT"], "routine", "req", "2026-10-20", "fatigue", None, None),
    (2, 2, 2, 3, ["HBA1C", "LIPID", "UEC"], "routine", "req", "2026-10-21", "t2dm", None, None),
    (3, 4, 3, 1, ["LIPID", "FBG"], "routine", "rec", "2026-10-19", "lipid", None, None),
    (4, 11, 3, 1, ["TSH"], "routine", "acc", "2026-10-16", "hypothyroid", None, None),
    (5, 17, 3, 1, ["INR"], "urgent", "coll", "2026-10-22", "af", "dva", "On warfarin. Please phone INR result to the practice."),
    (6, 6, 5, 2, ["FBC", "FERR", "B12"], "routine", "lab", "2026-10-20", "fatigue", None, None),
    (7, 7, 5, 2, ["PSA"], "routine", "done", "2026-10-05", None, None, None),
    (8, 13, 5, 2, ["HBA1C", "UEC"], "routine", "done", "2026-09-28", "t2dm", "conc", None),
    (9, 19, 5, 2, ["MSU"], "routine", "prelim", "2026-10-23", "dysuria", None, None),
    (10, 5, 4, 4, ["FBC", "UEC"], "routine", "done", "2026-09-03", "fatigue", None, None),
    (11, 12, 4, 4, ["TSH", "LIPID"], "routine", "cancel", "2026-10-02", "hypothyroid", None, "Duplicate request - cancelled by practice."),
    (12, 18, 4, 4, ["FBG", "HBA1C"], "routine", "reject", "2026-10-14", "t2dm", None, None),
    (13, 10, 2, 3, ["FBC", "GRPAB", "RUB", "HBSAG"], "routine", "coll", "2026-10-22", "preg", None, "Antenatal booking bloods, 10 weeks."),
    (14, 20, 6, 3, ["TROP", "FBC", "UEC"], "urgent", "acc", "2026-10-24", "chest", None, "Urgent - phone results to the clinic."),
    (15, 14, 6, 3, ["FERR", "FBC"], "routine", "hold", "2026-10-18", "fatigue", "private", None),
]
PATH_STATUS_REASON = {"hold": "Awaiting patient attendance for collection.",
                      "reject": "Request rejected: patient Medicare number does not match the patient name."}
FASTING = "https://healthterminologies.gov.au/fhir/ValueSet/pathology-fasting-status-1"


def lab_org(k):
    name, _, _, h, _, _ = PATHOLOGY[k]
    return {"reference": "Organization/qhc-org-path%d" % k, "type": "Organization", "identifier": {"system": HPIO, "value": h}, "display": name}


def coverage(pi, kind):
    pid = "Patient/qhc-pat-%02d" % pi
    c = {"resourceType": "Coverage", "id": "qhc-cov-%02d" % pi, "meta": {"profile": [P + "au-erequesting-coverage"]},
         "status": "active", "beneficiary": ref(pid)}
    if kind == "dva":  # fictional DVA file number; payor as in the IG's DVA example
        c["identifier"] = [{"type": {"coding": [{"system": AUV2, "code": "DVAU", "display": "DVA Number"}], "text": "DVA Number"},
                            "system": "http://ns.electronichealth.net.au/id/dva", "value": "QX99%04d" % pi}]
        c["type"] = cc("http://terminology.hl7.org/CodeSystem/v3-ActCode", "VET", "veteran health program")
        c["payor"] = [{"identifier": {"type": {"coding": [{"system": V2, "code": "XX"}], "text": "ABN"},
                                      "system": "http://hl7.org.au/id/abn", "value": "23964290824"}, "display": "Department of Veterans' Affairs"}]
    else:
        c["type"] = cc("http://terminology.hl7.org/CodeSystem/coverage-selfpay", *{"conc": ("payconc", "Concession"), "private": ("pay", "Pay")}[kind])
        c["payor"] = [ref(pid)]
    return c


def path_entries(row):
    n, pi, rf, lab, tests, prio, state, auth, rk, cov, note = row
    pid = "Patient/qhc-pat-%02d" % pi
    role = "PractitionerRole/qhc-role-%d" % rf
    rdisp = "%s %s" % (REFERRERS[rf][5][3], REFERRERS[rf][5][1])
    rorg = REFERRERS[rf][0]
    pgn = "LAB-QHC-%04d" % n
    sysn = pgn_system(rf)
    tstat, biz, srstat = PATH_STATE[state]
    reason = PATH_REASON[rk]
    enc_id, gt_id = "qhc-path-enc-%04d" % n, "qhc-path-taskgroup-%04d" % n
    es = [{"resourceType": "Encounter", "id": enc_id, "meta": {"profile": [P + "au-erequesting-encounter"]},
           "status": "finished", "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB", "display": "ambulatory"},
           "serviceType": cc(SCT, *(("700232004", "General medical service") if rf == 6 else ("788007007", "General practice service"))),
           "subject": ref(pid),
           "participant": [{"type": [cc("http://terminology.hl7.org/CodeSystem/v3-ParticipationType", "PPRF", "primary performer")],
                            "individual": ref(role, rdisp)}],
           "period": {"start": tz(auth, 10, 0), "end": tz(auth, 10, 15)},
           "serviceProvider": ref("Organization/qhc-org-ref%d" % rf, rorg)}]
    if reason:
        es[0]["reasonCode"] = [cc(SCT, reason[0], reason[1])]
    if cov:
        es.append(coverage(pi, cov))
    preg_id = None
    if rk == "preg":
        preg_id = "qhc-pregstatus-%04d" % n
        es.append({"resourceType": "Observation", "id": preg_id,
                   "meta": {"profile": ["http://hl7.org/fhir/uv/ips/StructureDefinition/Observation-pregnancy-status-uv-ips"]},
                   "status": "final", "code": cc("http://loinc.org", "82810-3", "Pregnancy status"), "subject": ref(pid),
                   "effectiveDateTime": tz(auth, 10, 5), "valueCodeableConcept": cc("http://loinc.org", "LA15173-0", "Pregnant")})
    last = tz(auth, 14, 0) if state == "req" else tz((dt.date.fromisoformat(auth) + dt.timedelta(days=1)).isoformat(), 9, 0)
    if state == "done":
        last = tz((dt.date.fromisoformat(auth) + dt.timedelta(days=3)).isoformat(), 16, 30)
    assigner = ref("Organization/qhc-org-ref%d" % rf, rorg)
    group_id = {"type": {"coding": [{"system": V2, "code": "PGN"}], "text": "Placer Group Number"}, "system": sysn, "value": pgn, "assigner": assigner}

    def task(rid, profile, tagcode):
        t = {"resourceType": "Task", "id": rid, "meta": {"profile": [P + profile], "tag": [{"system": TAG, "code": tagcode}]},
             "groupIdentifier": group_id, "status": tstat}
        if biz: t["businessStatus"] = cc(TBS, biz)
        if state in PATH_STATUS_REASON: t["statusReason"] = {"text": PATH_STATUS_REASON[state]}
        t.update({"intent": "order", "priority": prio, "code": cc(TCODE, "fulfill"), "for": ref(pid),
                  "authoredOn": tz(auth, 10, 15), "lastModified": last, "requester": ref(role, rdisp), "owner": lab_org(lab)})
        return t
    es.append(task(gt_id, "au-erequesting-task-group", "fulfilment-task-group"))
    for i, tk in enumerate(tests, 1):
        code, disp, text, fasting = PATH_TESTS[tk]
        sr_id, plac = "qhc-path-sr-%04d-%02d" % (n, i), "%s-%02d" % (pgn, i)
        ext = [{"url": P + "au-erequesting-displaysequence", "valueInteger": i}]
        if fasting:
            ext.append({"url": P + "au-erequesting-fastingprecondition", "valueCodeableConcept": cc(SCT, "16985007", "Fasting")})
        if state == "hold":
            ext.append({"url": "http://hl7.org/fhir/StructureDefinition/request-statusReason",
                        "valueCodeableConcept": {"text": PATH_STATUS_REASON[state]}})
        sr = {"resourceType": "ServiceRequest", "id": sr_id, "meta": {"profile": [P + "au-erequesting-servicerequest-path"]},
              "extension": ext,
              "identifier": [{"type": {"coding": [{"system": V2, "code": "PLAC", "display": "Placer Identifier"}]},
                              "system": sysn, "value": plac, "assigner": {"display": rorg}}],
              "requisition": {"type": {"coding": [{"system": V2, "code": "PGN", "display": "Placer Group Number"}]},
                              "system": sysn, "value": pgn, "assigner": {"display": rorg}},
              "status": srstat, "intent": "order",
              "category": [cc(SCT, "108252007", "Laboratory procedure")],
              "priority": prio,
              "code": {"coding": [{"system": SCT, "code": code, "display": disp}], "text": text},
              "subject": ref(pid), "encounter": ref("Encounter/" + enc_id),
              "authoredOn": tz(auth, 10, 15), "requester": ref(role, rdisp)}
        if reason:
            sr["reasonCode"] = [cc(SCT, reason[0], reason[1])]
        if cov:
            sr["insurance"] = [ref("Coverage/qhc-cov-%02d" % pi)]
        if preg_id:
            sr["supportingInfo"] = [ref("Observation/" + preg_id, "Pregnancy status")]
        if note:
            sr["note"] = [{"text": note}]
        es.append(sr)
        t = task("qhc-path-task-%04d-%02d" % (n, i), "au-erequesting-task-diagnosticrequest", "fulfilment-task")
        t["identifier"] = [{"type": {"coding": [{"system": V2, "code": "PLAC", "display": "Placer Identifier"}]},
                            "system": sysn, "value": plac, "assigner": assigner}]
        t["partOf"] = [ref("Task/" + gt_id)]
        t["focus"] = ref("ServiceRequest/" + sr_id)
        es.append(t)
    return es


assert len({r[1] for r in PATH_REQUESTS if r[9]}) == len([r for r in PATH_REQUESTS if r[9]]), "one Coverage per patient"


# ---------------------------------------------------------------- clinical summary data (AU Patient Summary / IPS)
# Extra clinical history for 14 of the 20 patients so Patient/[id]/$summary (AU PS) returns Allergies, Medication List,
# Problem List, History of Procedures and Results sections. Everything is FICTIONAL and chosen to fit the patient's
# existing referral / pathology orders. Ids are qhc-ps-*, resources are PUT with fixed ids, existing resources untouched.
LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
AMT = SCT  # AMT concepts are SNOMED CT-AU concepts (MPUU = medicinal product unit of use)
OBSCAT = "http://terminology.hl7.org/CodeSystem/observation-category"
ALGSTAT = "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical"
ALGVER = "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification"
CONDCLIN = "http://terminology.hl7.org/CodeSystem/condition-clinical"
CONDVER = "http://terminology.hl7.org/CodeSystem/condition-ver-status"
PSP = CORE  # AU Core 2.0.0 profiles live under http://hl7.org.au/fhir/core/StructureDefinition/

CONDS = {  # key -> (SNOMED CT code, display)
    "htn": ("38341003", "Hypertension"), "gord": ("235595009", "Gastro-oesophageal reflux disease"),
    "t2dm": ("44054006", "Type 2 diabetes mellitus"), "lipid": ("55822004", "Hyperlipidaemia"),
    "oa": ("396275006", "Osteoarthritis"), "ida": ("87522002", "Iron deficiency anaemia"),
    "bph": ("266569009", "Benign prostatic hyperplasia"), "hypothy": ("40930008", "Hypothyroidism"),
    "preg": ("72892002", "Normal pregnancy"), "af": ("49436004", "Atrial fibrillation"),
    "asthma": ("195967001", "Asthma"), "uti": ("68566005", "Urinary tract infection"),
    "pneu": ("233604007", "Pneumonia"), "sinus": ("36971009", "Sinusitis"),
}
SUBST = {  # allergy substance -> (code, display)
    "pen": ("764146007", "Penicillin"), "cod": ("387494007", "Codeine"), "sulfa": ("387406002", "Sulfonamide"),
    "asa": ("387458008", "Aspirin"), "nka": ("716186003", "No known allergy"),
}
REACT = {"rash": ("271807003", "Rash"), "ana": ("39579001", "Anaphylaxis"), "nau": ("422587007", "Nausea")}
MEDS = {  # key -> (AMT MPUU code, display, dosage text, timing (frequency, period, unit), route code, route display, prn)
    "perind": ("21966011000036105", "Perindopril arginine 5 mg tablet", "One tablet orally once daily in the morning", (1, 1, "d"), False),
    "panto": ("23003011000036103", "Pantoprazole 40 mg enteric tablet", "One tablet orally once daily before breakfast", (1, 1, "d"), False),
    "metf": ("23358011000036102", "Metformin hydrochloride 500 mg tablet", "One tablet orally twice daily with meals", (2, 1, "d"), False),
    "metf2": ("23358011000036102", "Metformin hydrochloride 500 mg tablet", "Two tablets orally twice daily with meals", (2, 1, "d"), False),
    "glic": ("23223011000036101", "Gliclazide 30 mg modified release tablet", "One tablet orally once daily with breakfast", (1, 1, "d"), False),
    "ator": ("22784011000036109", "Atorvastatin 20 mg tablet", "One tablet orally once daily at night", (1, 1, "d"), False),
    "para": ("23628011000036109", "Paracetamol 500 mg tablet", "Two tablets orally every 6 hours when required for pain, maximum 8 tablets in 24 hours", (4, 1, "d"), True),
    "iron": ("62075011000036106", "Ferrous sulfate 250 mg (iron 80 mg) + folic acid 300 microgram modified release tablet", "One tablet orally once daily", (1, 1, "d"), False),
    "tams": ("765922006", "Tamsulosin hydrochloride 400 microgram prolonged-release oral capsule", "One capsule orally once daily after the same meal each day", (1, 1, "d"), False),
    "levo": ("23345011000036105", "Levothyroxine sodium 100 microgram tablet", "One tablet orally once daily on an empty stomach, 30 minutes before breakfast", (1, 1, "d"), False),
    "folic": ("22410011000036105", "Folic acid 500 microgram tablet", "One tablet orally once daily", (1, 1, "d"), False),
    "warf": ("22464011000036101", "Warfarin sodium 5 mg tablet", "Dose as directed by INR, currently one tablet orally once daily in the evening", (1, 1, "d"), False),
    "salb": ("770300007", "Salbutamol (as salbutamol sulfate) 100 microgram/actuation pressurised suspension for inhalation", "Two puffs by inhalation when required for wheeze or breathlessness", (4, 1, "d"), True),
}
PROCS = {  # key -> (SNOMED CT code, display)
    "colon": ("73761001", "Colonoscopy"), "appx": ("80146002", "Appendicectomy"),
    "arthro": ("309431009", "Arthroscopy of knee"), "hernia": ("44558001", "Repair of inguinal hernia"),
    "tkr": ("609588000", "Total knee replacement"), "disc": ("239542002", "Lumbar discectomy"),
    "cataract": ("54885007", "Extraction of cataract"), "tonsil": ("173422009", "Tonsillectomy"),
    "lapchol": ("45595009", "Laparoscopic cholecystectomy"),
}
LABS = {  # key -> (LOINC, display, unit, UCUM code)
    "alt": ("1742-6", "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma", "U/L", "U/L"),
    "creat": ("14682-9", "Creatinine [Moles/volume] in Serum or Plasma", "umol/L", "umol/L"),
    "hba1c": ("4548-4", "Hemoglobin A1c/Hemoglobin.total in Blood", "%", "%"),
    "fglu": ("14771-0", "Fasting glucose [Moles/volume] in Serum or Plasma", "mmol/L", "mmol/L"),
    "hb": ("718-7", "Hemoglobin [Mass/volume] in Blood", "g/L", "g/L"),
    "ferr": ("2276-4", "Ferritin [Mass/volume] in Serum or Plasma", "ug/L", "ug/L"),
    "tsh": ("3016-3", "Thyrotropin [Units/volume] in Serum or Plasma", "mIU/L", "m[IU]/L"),
    "chol": ("14647-2", "Cholesterol [Moles/volume] in Serum or Plasma", "mmol/L", "mmol/L"),
    "ldl": ("22748-8", "Cholesterol in LDL [Moles/volume] in Serum or Plasma", "mmol/L", "mmol/L"),
    "hdl": ("14646-4", "Cholesterol in HDL [Moles/volume] in Serum or Plasma", "mmol/L", "mmol/L"),
    "tg": ("14927-8", "Triglyceride [Moles/volume] in Serum or Plasma", "mmol/L", "mmol/L"),
    "inr": ("6301-6", "INR in Platelet poor plasma by Coagulation assay", "{INR}", "{INR}"),
    "psa": ("2857-1", "Prostate specific Ag [Mass/volume] in Serum or Plasma", "ug/L", "ug/L"),
}
# patient -> clinical history. Conditions: (key, status, onset, abatement|None); allergies: (key, reaction, severity, onset);
# meds: (key, authoredOn, kind) kind "req" = MedicationRequest, "stmt" = MedicationStatement;
# procedures: (key, date); labs: (key, value, date); vitals: ("bp", systolic, diastolic, date) / ("hr", rate, date)
PS_DATA = {
    1: dict(cond=[("htn", "active", "2015-05-12", None), ("gord", "active", "2019-08-03", None)],
            alg=[("pen", "rash", "mild", "2003-01-01")],
            meds=[("perind", "2025-11-04", "req"), ("panto", "2025-11-04", "req")],
            proc=[("colon", "2024-03-14")],
            labs=[("alt", 62, "2026-10-11"), ("creat", 98, "2026-10-11")], vit=[("bp", 148, 92, "2026-10-14")]),
    2: dict(cond=[("t2dm", "active", "2023-02-20", None), ("uti", "resolved", "2025-04-02", "2025-04-12")],
            alg=[("nka",)],
            meds=[("metf", "2023-02-20", "req")],
            proc=[], labs=[("hba1c", 7.8, "2026-07-09"), ("fglu", 8.1, "2026-07-09")], vit=[("hr", 78, "2026-10-15")]),
    4: dict(cond=[("lipid", "active", "2024-06-18", None)],
            alg=[("cod", "nau", "mild", "2016-09-01")],
            meds=[("ator", "2024-06-18", "req")],
            proc=[("appx", "2005-02-27")],
            labs=[("chol", 6.2, "2026-10-02"), ("ldl", 4.1, "2026-10-02"), ("hdl", 1.1, "2026-10-02"), ("tg", 2.4, "2026-10-02")], vit=[]),
    5: dict(cond=[("oa", "active", "2018-03-09", None), ("htn", "active", "2012-07-21", None)],
            alg=[("sulfa", "rash", "moderate", "1998-06-01")],
            meds=[("para", "2025-09-15", "req"), ("perind", "2025-09-15", "req")],
            proc=[("arthro", "2019-05-23")],
            labs=[("hb", 128, "2026-09-08")], vit=[("bp", 142, 86, "2026-09-08")]),
    6: dict(cond=[("ida", "active", "2026-10-06", None), ("pneu", "resolved", "2024-07-15", "2024-08-10")],
            alg=[("nka",)],
            meds=[("iron", "2026-10-06", "req")],
            proc=[], labs=[("hb", 104, "2026-10-06"), ("ferr", 9, "2026-10-06")], vit=[]),
    7: dict(cond=[("bph", "active", "2022-01-25", None)],
            alg=[("asa", "ana", "severe", "1999-01-01")],
            meds=[("tams", "2022-01-25", "req")],
            proc=[("hernia", "2012-11-08")],
            labs=[("psa", 3.9, "2026-10-05")], vit=[]),
    10: dict(cond=[("preg", "active", "2026-08-12", None)],
             alg=[("nka",)],
             meds=[("folic", "2026-10-22", "req")],
             proc=[], labs=[("hb", 118, "2026-10-22")], vit=[("bp", 112, 70, "2026-10-22")]),
    11: dict(cond=[("hypothy", "active", "2019-04-02", None), ("sinus", "resolved", "2026-03-10", "2026-03-24")],
             alg=[("nka",)],
             meds=[("levo", "2019-04-02", "req")],
             proc=[], labs=[("tsh", 6.8, "2026-10-16")], vit=[]),
    12: dict(cond=[("hypothy", "active", "2015-10-19", None)],
             alg=[("cod", "nau", "mild", "2010-01-01")],
             meds=[("levo", "2015-10-19", "req")],
             proc=[("tkr", "2022-06-14")],
             labs=[("tsh", 2.1, "2026-10-02")], vit=[]),
    13: dict(cond=[("t2dm", "active", "2016-09-14", None), ("htn", "active", "2016-09-14", None)],
             alg=[("nka",)],
             meds=[("metf2", "2020-03-02", "req"), ("glic", "2024-02-12", "req")],
             proc=[("disc", "2009-04-30")],
             labs=[("hba1c", 8.4, "2026-09-28"), ("creat", 84, "2026-09-28")], vit=[("bp", 136, 84, "2026-09-28")]),
    17: dict(cond=[("af", "active", "2017-11-30", None), ("htn", "active", "2005-03-04", None)],
             alg=[("cod", "rash", "mild", "2011-01-01")],
             meds=[("warf", "2017-12-05", "req"), ("para", "2026-10-01", "stmt")],
             proc=[("cataract", "2023-08-22")],
             labs=[("inr", 2.6, "2026-10-22")], vit=[("hr", 72, "2026-10-22")]),
    18: dict(cond=[("t2dm", "active", "2021-05-10", None)],
             alg=[("nka",)],
             meds=[("metf2", "2021-05-10", "req"), ("folic", "2026-08-01", "stmt")],
             proc=[], labs=[("hba1c", 9.1, "2026-10-14"), ("fglu", 9.6, "2026-10-14")], vit=[]),
    19: dict(cond=[("asthma", "active", "2005-02-15", None), ("uti", "active", "2026-10-23", None)],
             alg=[("pen", "rash", "moderate", "2008-01-01")],
             meds=[("salb", "2020-06-01", "req")],
             proc=[("tonsil", "1992-07-20")],
             labs=[("hb", 141, "2026-10-23")], vit=[("hr", 84, "2026-10-23")]),
    20: dict(cond=[("gord", "active", "2025-02-09", None)],
             alg=[("nka",)],
             meds=[("panto", "2025-02-09", "req")],
             proc=[], labs=[("hb", 135, "2026-10-24")], vit=[("bp", 118, 76, "2026-10-24"), ("hr", 70, "2026-10-24")]),
}
PS_REQ_PRACT = {}  # patient -> referrer role (first referral / pathology order that names the patient)
for _r in REFERRALS:
    PS_REQ_PRACT.setdefault(_r[1], _r[2])
for _r in PATH_REQUESTS:
    PS_REQ_PRACT.setdefault(_r[1], _r[2])


def ps_entries(i):
    d = PS_DATA[i]
    pid = "Patient/qhc-pat-%02d" % i
    rf = PS_REQ_PRACT[i]
    role = ref("PractitionerRole/qhc-role-%d" % rf, "%s %s" % (REFERRERS[rf][5][3], REFERRERS[rf][5][1]))
    out = []
    for n, (k, status, onset, abate) in enumerate(d["cond"], 1):
        c = {"resourceType": "Condition", "id": "qhc-ps-cond-%02d-%d" % (i, n), "meta": {"profile": [PSP + "au-core-condition"]},
             "clinicalStatus": cc(CONDCLIN, status), "verificationStatus": cc(CONDVER, "confirmed"),
             "category": [cc("http://terminology.hl7.org/CodeSystem/condition-category", "problem-list-item")],
             "code": cc(SCT, *CONDS[k]), "subject": ref(pid), "onsetDateTime": onset}
        if abate: c["abatementDateTime"] = abate
        out.append(c)
    for n, a in enumerate(d["alg"], 1):
        code, disp = SUBST[a[0]]
        r = {"resourceType": "AllergyIntolerance", "id": "qhc-ps-alg-%02d-%d" % (i, n), "meta": {"profile": [PSP + "au-core-allergyintolerance"]},
             "clinicalStatus": cc(ALGSTAT, "active"), "verificationStatus": cc(ALGVER, "confirmed"),
             "code": cc(SCT, code, disp), "patient": ref(pid), "recordedDate": "2026-10-01"}
        if a[0] != "nka":
            _, react, sev, onset = a
            r["type"] = "allergy" if react != "nau" else "intolerance"
            r["category"] = ["medication"]
            r["criticality"] = "high" if sev == "severe" else "low"
            r["onsetDateTime"] = onset[:4]
            r["reaction"] = [{"manifestation": [cc(SCT, *REACT[react])], "severity": sev}]
        out.append(r)
    for n, (k, auth, kind) in enumerate(d["meds"], 1):
        code, disp, text, (freq, per, unit), prn = MEDS[k]
        dose = {"text": text, "timing": {"repeat": {"frequency": freq, "period": per, "periodUnit": unit}},
                "route": cc(SCT, "447694001", "Respiratory tract route") if k == "salb" else cc(SCT, "26643006", "Oral route"),
                "asNeededBoolean": prn}
        med = cc(AMT, code, disp)
        if kind == "req":
            r = {"resourceType": "MedicationRequest", "id": "qhc-ps-mr-%02d-%d" % (i, n), "meta": {"profile": [PSP + "au-core-medicationrequest"]},
                 "status": "active", "intent": "order", "medicationCodeableConcept": med, "subject": ref(pid),
                 "authoredOn": auth, "requester": role, "dosageInstruction": [dose]}
        else:
            r = {"resourceType": "MedicationStatement", "id": "qhc-ps-ms-%02d-%d" % (i, n),
                 "status": "active", "medicationCodeableConcept": med, "subject": ref(pid),
                 "effectiveDateTime": auth, "dateAsserted": "2026-10-01", "dosage": [dose]}
        out.append(r)
    for n, (k, date) in enumerate(d["proc"], 1):
        out.append({"resourceType": "Procedure", "id": "qhc-ps-proc-%02d-%d" % (i, n), "meta": {"profile": [PSP + "au-core-procedure"]},
                    "status": "completed", "code": cc(SCT, *PROCS[k]), "subject": ref(pid), "performedDateTime": date})
    for n, (k, val, date) in enumerate(d["labs"], 1):
        code, disp, unit, ucum = LABS[k]
        out.append({"resourceType": "Observation", "id": "qhc-ps-lab-%02d-%d" % (i, n), "meta": {"profile": [PSP + "au-core-diagnosticresult-path"]},
                    "status": "final", "category": [cc(OBSCAT, "laboratory"), cc(SCT, "108252007", "Laboratory procedure")],
                    "code": cc(LOINC, code, disp), "subject": ref(pid), "effectiveDateTime": date,
                    "valueQuantity": {"value": val, "unit": unit, "system": UCUM, "code": ucum}})
    for n, v in enumerate(d["vit"], 1):
        base = {"resourceType": "Observation", "id": "qhc-ps-vit-%02d-%d" % (i, n), "status": "final",
                "category": [cc(OBSCAT, "vital-signs")], "subject": ref(pid)}
        if v[0] == "bp":
            _, sy, di, date = v
            base["meta"] = {"profile": [PSP + "au-core-bloodpressure"]}
            base["code"] = {"coding": [cc(LOINC, "85354-9", "Blood pressure panel with all children optional")["coding"][0], {"system": SCT, "code": "75367002", "display": "Blood pressure"}]}
            base["effectiveDateTime"] = date
            base["component"] = [{"code": {"coding": [{"system": LOINC, "code": "8480-6", "display": "Systolic blood pressure"}, {"system": SCT, "code": "271649006", "display": "Systolic blood pressure"}]}, "valueQuantity": {"value": sy, "unit": "mm[Hg]", "system": UCUM, "code": "mm[Hg]"}},
                                 {"code": {"coding": [{"system": LOINC, "code": "8462-4", "display": "Diastolic blood pressure"}, {"system": SCT, "code": "271650006", "display": "Diastolic blood pressure"}]}, "valueQuantity": {"value": di, "unit": "mm[Hg]", "system": UCUM, "code": "mm[Hg]"}}]
        else:
            _, hr, date = v
            base["meta"] = {"profile": [PSP + "au-core-heartrate"]}
            base["code"] = {"coding": [{"system": LOINC, "code": "8867-4", "display": "Heart rate"}, {"system": SCT, "code": "364075005", "display": "Heart rate"}]}
            base["effectiveDateTime"] = date
            base["valueQuantity"] = {"value": hr, "unit": "/min", "system": UCUM, "code": "/min"}
        out.append(base)
    return out


if __name__ == "__main__":
    write("00-referrers.json", referrer_entries())
    write("01-schedules-slots.json", schedules_and_slots())
    for i in range(1, 21):
        es = [patient(i)]
        for row in REFERRALS:
            if row[1] == i:
                es += referral_entries(row)
        for row in PATH_REQUESTS:
            if row[1] == i:
                es += path_entries(row)
        if i in PS_DATA:
            es += ps_entries(i)
        write("patient-%02d.json" % i, es)
    print("written")
