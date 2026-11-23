"""KYC level 2 (Security plan Phase 8): where else is this e-mail address used?

Open source only (decision 2026-11-22: no paid or keyed services, so no SEON):
  - Holehe 1.61 (GPL-3.0, github.com/megadose/holehe): each module asks one site whether an
    address is taken. Only modules whose method is "register" may run: they ask the sign-up
    form, which is the kind that sends nothing to the address. Password-recovery and login
    modules (which could e-mail or alert the person) never run, nor do the porn, medical and
    people-search (osint) categories: being registered there is sensitive data we must not
    learn. The default list is 20 mainstream services (KYC_L2_MODULES overrides, within those
    rules).
  - Gravatar: one request with the SHA-256 of the address (never the address itself).

What is kept: which services answered "registered", how many were asked and answered, and
Gravatar yes / no. Never a service's answer, a recovery address or a phone hint (some Holehe
modules return them; they are dropped here).

The lookups run in their own container (`python -m app.l2_runner`), so a hanging site never
delays level 1 or level 3; every module has its own timeout.
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib
import inspect
import logging
import os
import pkgutil
import re
import time
from typing import Awaitable, Callable, Optional

log = logging.getLogger("kyc-l2")

DEFAULT_MODULES = (
    "instagram", "twitter", "discord", "pinterest", "spotify", "google", "github", "imgur", "tumblr", "firefox",
    "lastpass", "quora", "wattpad", "freelancer", "soundcloud", "strava", "archive", "codecademy", "envato", "nike",
)
# never run, whatever the configuration
BANNED_CATEGORIES = {"porn", "medical", "osint"}
ALLOWED_METHOD = "register"

# The score this level adds to level 1's (informational: no decision reads it).
NO_FOOTPRINT_MIN_ANSWERED = 5


def points() -> dict:
    num = lambda n, d: int(float(os.environ.get(n, d)))
    return {"email_no_footprint": num("KYC_L2_NO_FOOTPRINT_POINTS", 15), "email_established": num("KYC_L2_ESTABLISHED_POINTS", -10)}


def assess(found: list[str], answered: int, gravatar: Optional[bool]) -> tuple[list[str], int]:
    """Reasons and points from a level 2 result.
    - email_no_footprint: enough services answered, none knows the address, no Gravatar: a
      fresh or throwaway address (+15);
    - email_established: known to 3+ services or a Gravatar: a lived-in address (-10)."""
    p = points()
    if len(found) >= 3 or gravatar:
        return ["email_established"], p["email_established"]
    if answered >= NO_FOOTPRINT_MIN_ANSWERED and not found and gravatar is False:
        return ["email_no_footprint"], p["email_no_footprint"]
    return [], 0


# --------------------------------------------------------------------- holehe modules

def _method_of(fn) -> Optional[str]:
    try:
        m = re.search(r"""^\s*method\s*=\s*['"]([^'"]+)['"]""", inspect.getsource(fn), re.M)
        return m.group(1) if m else None
    except (OSError, TypeError):
        return None


def available_modules() -> dict[str, dict]:
    """Every Holehe module: name → {fn, category, method, allowed}."""
    import holehe.modules as pkg  # imported here: level 1/3 containers never load it

    out: dict[str, dict] = {}
    for info in pkgutil.walk_packages(pkg.__path__, pkg.__name__ + "."):
        if info.ispkg:
            continue
        parts = info.name.split(".")
        name, category = parts[-1], parts[-2]
        try:
            mod = importlib.import_module(info.name)
        except Exception as e:  # a module that no longer imports is simply absent
            log.warning("holehe module %s not loaded: %s", name, type(e).__name__)
            continue
        fn = getattr(mod, name, None)
        if not inspect.iscoroutinefunction(fn):
            continue
        method = _method_of(fn)
        out[name] = {"fn": fn, "category": category, "method": method,
                     "allowed": method == ALLOWED_METHOD and category not in BANNED_CATEGORIES}
    return out


def chosen_modules(available: dict[str, dict], wanted: Optional[str] = None) -> tuple[dict[str, Callable], list[str]]:
    """The modules to run: KYC_L2_MODULES (comma list) or the default list, minus anything
    the rules forbid. Returns ({name: fn}, refused names)."""
    raw = wanted if wanted is not None else os.environ.get("KYC_L2_MODULES", "")
    names = [n.strip().lower() for n in raw.split(",") if n.strip()] or list(DEFAULT_MODULES)
    run, refused = {}, []
    for n in names:
        m = available.get(n)
        if m and m["allowed"]:
            run[n] = m["fn"]
        else:
            refused.append(n)
    return run, refused


# --------------------------------------------------------------------- the lookup

GRAVATAR_URL = "https://gravatar.com/avatar/{}?d=404&s=1"


async def gravatar_known(email: str, client) -> Optional[bool]:
    """True / False, None when Gravatar did not answer clearly. Sends only a SHA-256."""
    h = hashlib.sha256(email.strip().lower().encode()).hexdigest()
    try:
        r = await client.get(GRAVATAR_URL.format(h))
    except Exception:
        return None
    return True if r.status_code == 200 else (False if r.status_code == 404 else None)


async def _one(name: str, fn, email: str, client, timeout: float) -> tuple[str, Optional[bool]]:
    """(name, True registered | False not registered | None no clear answer)."""
    out: list[dict] = []
    try:
        await asyncio.wait_for(fn(email, client, out), timeout)
    except Exception:  # timeout, network, a site that changed: no answer
        return name, None
    for row in out:
        if not isinstance(row, dict) or row.get("rateLimit"):
            continue
        return name, bool(row.get("exists"))
    return name, None


async def lookup(email: str, modules: dict[str, Callable], timeout: float = 15.0, concurrency: int = 6,
                 client_factory: Optional[Callable[[], object]] = None,
                 gravatar: Optional[Callable[[str, object], Awaitable[Optional[bool]]]] = gravatar_known) -> dict:
    """Runs the modules (and Gravatar) for one address. Returns only booleans and names."""
    if client_factory is None:
        import httpx
        client_factory = lambda: httpx.AsyncClient(timeout=timeout)
    sem = asyncio.Semaphore(concurrency)
    t0 = time.time()

    async def guarded(name, fn, client):
        async with sem:
            return await _one(name, fn, email, client, timeout)

    async with client_factory() as client:
        tasks = [guarded(n, f, client) for n, f in modules.items()]
        if gravatar is not None:
            tasks.append(_grav(gravatar, email, client, timeout))
        answers = await asyncio.gather(*tasks)
    grav = None
    found, answered = [], 0
    for name, v in answers:
        if name == "__gravatar__":
            grav = v
            continue
        if v is None:
            continue
        answered += 1
        if v:
            found.append(name)
    return {"found": sorted(found), "asked": len(modules), "answered": answered, "gravatar": grav,
            "ms": int((time.time() - t0) * 1000)}


async def _grav(fn, email, client, timeout):
    try:
        return "__gravatar__", await asyncio.wait_for(fn(email, client), timeout)
    except Exception:
        return "__gravatar__", None
