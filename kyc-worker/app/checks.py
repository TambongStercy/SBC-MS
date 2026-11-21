"""Level 1 KYC checks (Security plan Phase 8): local computation only, plus one
cached DNS query per email domain. Nothing here contacts the member.

Every function takes plain values and returns plain dicts, so the whole level
is testable without a network (the DNS lookup is passed in).
"""
from __future__ import annotations

import json
import math
import os
import re
from typing import Callable, Optional

import phonenumbers
from phonenumbers import PhoneNumberType, carrier
from disposable_email_domains import blocklist as DISPOSABLE

_HERE = os.path.dirname(__file__)
with open(os.path.join(_HERE, "country_names.json"), encoding="utf-8") as f:
    COUNTRY_NAMES: dict[str, str] = json.load(f)

# --------------------------------------------------------------------- countries


def country_code(raw: Optional[str]) -> Optional[str]:
    """ISO-2 from a stored country value: a code, or one of the names members typed."""
    if not raw or not isinstance(raw, str):
        return None
    v = raw.strip()
    if not v:
        return None
    hit = COUNTRY_NAMES.get(v.lower())
    if hit:
        return hit
    if re.fullmatch(r"[A-Za-z]{2}", v):
        up = v.upper()
        return None if up in ("XX", "T1", "ZZ") else up  # Cloudflare's unknown / Tor
    return None


# --------------------------------------------------------------------- phones

# Operator families, so "MTN Cameroon", "MTN" and MTN_MOMO_CMR compare equal.
_FAMILY_WORDS = [
    ("mtn", "MTN"), ("orange", "ORANGE"), ("moov", "MOOV"), ("airtel", "AIRTEL"),
    ("vodacom", "MPESA"), ("safaricom", "MPESA"), ("mpesa", "MPESA"), ("m-pesa", "MPESA"),
    ("togo telecom", "TMONEY"), ("togocel", "TMONEY"), ("tmoney", "TMONEY"), ("t_money", "TMONEY"),
    ("free", "FREE"), ("expresso", "EXPRESSO"), ("celtiis", "CELTIIS"), ("africell", "AFRICELL"),
    ("vodafone", "VODAFONE"), ("telecel", "TELECEL"), ("libertis", "LIBERTIS"), ("glo", "GLO"),
    ("nexttel", "NEXTTEL"), ("camtel", "CAMTEL"),
]
# "Yas" is the 2024–2025 brand of Free (Senegal) and Togocel (Togo).
_YAS = {"SN": "FREE", "TG": "TMONEY"}
# Wallets that work on any operator's number: never compared.
_ANY_OPERATOR = {"WAVE", "CINETPAY", "PAYPAL", "CARD"}


def operator_family(name: Optional[str], region: Optional[str] = None) -> Optional[str]:
    if not name:
        return None
    n = name.strip().lower().replace("_", " ")
    if n.startswith("yas") or n == "yas":
        return _YAS.get(region or "", "YAS")
    if n.split(" ")[0].upper() in _ANY_OPERATOR:
        return n.split(" ")[0].upper()
    for word, fam in _FAMILY_WORDS:
        if n.startswith(word) or f" {word}" in f" {n}":
            return fam
    return None


def _digits(raw: Optional[str]) -> str:
    d = re.sub(r"\D", "", str(raw or ""))
    return d[2:] if d.startswith("00") else d


def _try_parse(text: str, region: Optional[str] = None):
    try:
        return phonenumbers.parse(text, region)
    except phonenumbers.NumberParseException:
        return None


def _legacy_variants(p) -> list[tuple[str, bool]]:
    """Numbers from before a national renumbering: (new form, carrier reliable)."""
    region = phonenumbers.region_code_for_country_code(p.country_code)
    nsn = phonenumbers.national_significant_number(p)
    if region == "BJ" and len(nsn) == 8:  # Benin, 2024: 01 + the old 8 digits
        return [(f"+229 01{nsn}", True)]
    if region == "GA" and len(nsn) == 8 and nsn[0] in "67":  # Gabon: 0 + the old 8 digits
        return [(f"+241 0{nsn}", True)]
    if region == "CI" and len(nsn) == 8:  # Côte d'Ivoire, 2021: the prefix depends on the old operator
        return [(f"+225 {pre}{nsn}", False) for pre in ("07", "05", "01")]
    return []


def phone_info(raw: Optional[str], declared_region: Optional[str] = None) -> Optional[dict]:
    """Validity, country, type and operator from the number alone (libphonenumber)."""
    d = _digits(raw)
    if len(d) < 6:
        return None if not d else {"valid": False, "region": None, "type": None, "operator": None, "legacy": False}
    p = _try_parse("+" + d)
    if (p is None or not phonenumbers.is_valid_number(p)) and declared_region:
        q = _try_parse(d, declared_region)  # a national number, stored without its dialling code
        if q is not None and phonenumbers.is_valid_number(q):
            p = q
    legacy = False
    carrier_ok = True
    if p is not None and not phonenumbers.is_valid_number(p):
        for text, reliable in _legacy_variants(p):
            q = _try_parse(text)
            if q is not None and phonenumbers.is_valid_number(q):
                p, legacy, carrier_ok = q, True, reliable
                break
    if p is None or not phonenumbers.is_valid_number(p):
        region = phonenumbers.region_code_for_country_code(p.country_code) if p is not None else None
        return {"valid": False, "region": region if region and region != "ZZ" else None, "type": None, "operator": None, "legacy": False}
    region = phonenumbers.region_code_for_number(p)
    t = phonenumbers.number_type(p)
    kind = "mobile" if t in (PhoneNumberType.MOBILE, PhoneNumberType.FIXED_LINE_OR_MOBILE) else ("fixed" if t == PhoneNumberType.FIXED_LINE else "other")
    op = operator_family(carrier.name_for_number(p, "en"), region) if carrier_ok else None
    return {"valid": True, "region": region, "type": kind, "operator": op, "legacy": legacy}


# --------------------------------------------------------------------- emails

FREE_PROVIDERS = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "ymail.com", "hotmail.com", "hotmail.fr", "outlook.com",
    "outlook.fr", "live.com", "live.fr", "msn.com", "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me",
    "gmx.com", "gmx.fr", "yandex.com", "mail.ru", "orange.fr", "laposte.net", "zoho.com",
}
_GMAIL = {"gmail.com", "googlemail.com"}
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$")
_VOWELS = set("aeiouy")


def normalized_email(email: str) -> str:
    """The mailbox the address really reaches: +tag dropped, Gmail dots dropped."""
    local, _, domain = email.strip().lower().partition("@")
    local = local.split("+", 1)[0]
    if domain in _GMAIL:
        local, domain = local.replace(".", ""), "gmail.com"
    return f"{local}@{domain}"


def random_looking(local: str) -> bool:
    """Keyboard-mash or generated local parts (xk7q2m9z, qwrtzpl…); names with years pass."""
    s = re.sub(r"[._+-]", "", local.lower())
    letters = re.sub(r"[^a-z]", "", s)
    if len(s) < 8 or len(letters) < 5:
        return False
    vowel_ratio = sum(c in _VOWELS for c in letters) / len(letters)
    longest_run = max((len(m) for m in re.findall(r"[^aeiouy]+", letters)), default=0)
    switches = len(re.findall(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", s))
    counts = {c: s.count(c) for c in set(s)}
    entropy = -sum(n / len(s) * math.log2(n / len(s)) for n in counts.values())
    return vowel_ratio < 0.15 or longest_run >= 6 or switches >= 4 or (switches >= 3 and entropy > 3.3)


def email_info(email: Optional[str], mx_lookup: Callable[[str], Optional[bool]]) -> Optional[dict]:
    if not email or not isinstance(email, str):
        return None
    e = email.strip().lower()
    if not EMAIL_RE.match(e):
        return {"syntax": False, "domain": None, "mx": None, "disposable": False, "free": False, "randomLooking": False, "plusTag": False, "gmailDots": False}
    local, _, domain = e.partition("@")
    return {
        "syntax": True,
        "domain": domain,
        "mx": mx_lookup(domain),  # True / False (no mail server) / None (DNS failed: unknown)
        "disposable": domain in DISPOSABLE,
        "free": domain in FREE_PROVIDERS,
        "randomLooking": random_looking(local.split("+", 1)[0]),
        "plusTag": "+" in local,
        "gmailDots": domain in _GMAIL and "." in local.split("+", 1)[0],
    }


# --------------------------------------------------------------------- level 1

# Measured on 20,000 real accounts (local copy, 2026-11-21): unusable addresses and invalid
# numbers are mostly honest typos (gmail.con, a space in the address, a truncated number), so
# alone they stay below "high"; the fraud-shaped signals (throwaway address, mismatched
# countries, another account on the same mailbox) weigh more.
WEIGHTS = {
    "phone_invalid": 20,
    "email_syntax": 15,
    "email_no_mx": 15,
    "email_disposable": 40,
    "email_random": 10,
    "momo_invalid": 15,
    "momo_operator_mismatch": 10,
    "phone_country_vs_declared": 15,
    "momo_country_vs_declared": 10,
    "network_country_elsewhere": 10,
}


def band(score: int) -> str:
    return "high" if score >= 50 else ("medium" if score >= 20 else "low")


def level1(item: dict, mx_lookup: Callable[[str], Optional[bool]]) -> dict:
    """One member's level 1: signals, the reasons that scored, a score 0–100 and a band."""
    declared = country_code(item.get("country"))
    ip = country_code(item.get("ipCountry"))
    geo = country_code(item.get("geoCountry"))
    phone = phone_info(item.get("phone"), declared)
    momo = phone_info(item.get("momoNumber"), declared) if item.get("momoNumber") else None
    declared_op = operator_family(item.get("momoOperator"), momo and momo.get("region"))
    email = email_info(item.get("email"), mx_lookup)

    reasons: list[str] = []
    if phone is not None and not phone["valid"]:
        reasons.append("phone_invalid")
    if email is not None:
        if not email["syntax"]:
            reasons.append("email_syntax")
        elif email["disposable"]:
            reasons.append("email_disposable")
        elif email["mx"] is False:
            reasons.append("email_no_mx")
        if email["syntax"] and email["randomLooking"]:
            reasons.append("email_random")
    if momo is not None and not momo["valid"]:
        reasons.append("momo_invalid")
    operator_match = None
    if momo and momo["valid"] and momo["operator"] and declared_op and declared_op not in _ANY_OPERATOR:
        operator_match = momo["operator"] == declared_op
        if not operator_match:
            reasons.append("momo_operator_mismatch")
    phone_region = phone["region"] if phone and phone["valid"] else None
    momo_region = momo["region"] if momo and momo["valid"] else None
    if declared and phone_region and phone_region != declared:
        reasons.append("phone_country_vs_declared")
    if declared and momo_region and momo_region != declared:
        reasons.append("momo_country_vs_declared")
    own = {c for c in (declared, phone_region, momo_region) if c}
    seen_from = {c for c in (ip, geo) if c}
    if own and seen_from and not (seen_from & own):
        reasons.append("network_country_elsewhere")

    score = min(100, sum(WEIGHTS[r] for r in reasons))
    return {
        "signals": {
            "phone": phone,
            "momo": momo and {**momo, "declaredOperator": declared_op, "operatorMatch": operator_match},
            "email": email,
            "countries": {"declared": declared, "phone": phone_region, "momo": momo_region, "ip": ip, "geo": geo},
        },
        "reasons": reasons,
        "score": score,
        "band": band(score),
        "emailNormalized": normalized_email(item["email"]) if email and email["syntax"] else None,
    }
