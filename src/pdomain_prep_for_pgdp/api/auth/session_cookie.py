"""Lightweight HMAC-SHA256 session cookie signer (stdlib only).

Cookie value format:
    <nonce>.<timestamp>.<hmac>

where:
  nonce     = 16 random hex bytes (32 chars)
  timestamp = integer unix seconds as decimal string
  hmac      = hex HMAC-SHA256 over "nonce.timestamp" with the server secret

No user data is stored in the cookie.  The cookie just proves the holder
presented the correct API key to our /api/auth/session endpoint at some
recent time.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

COOKIE_NAME = "pgdp_session"
_SEP = "."
_MAX_AGE_SECONDS = 8 * 3600  # 8-hour soft lifetime


def _sign(nonce: str, timestamp: str, secret: str) -> str:
    msg = f"{nonce}{_SEP}{timestamp}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def make_cookie_value(secret: str) -> str:
    """Return a fresh signed cookie value."""
    nonce = secrets.token_hex(16)
    ts = str(int(time.time()))
    sig = _sign(nonce, ts, secret)
    return f"{nonce}{_SEP}{ts}{_SEP}{sig}"


def verify_cookie_value(value: str, secret: str) -> bool:
    """Return True iff the cookie value has a valid signature and is not expired."""
    try:
        parts = value.split(_SEP)
        if len(parts) != 3:
            return False
        nonce, ts_str, sig = parts
        # Constant-time MAC check first.
        expected = _sign(nonce, ts_str, secret)
        if not hmac.compare_digest(sig, expected):
            return False
        # Expiry check (soft — does not invalidate on server restart).
        age = int(time.time()) - int(ts_str)
        return 0 <= age <= _MAX_AGE_SECONDS
    except (ValueError, OverflowError):
        return False
