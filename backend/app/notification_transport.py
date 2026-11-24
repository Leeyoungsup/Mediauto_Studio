"""Optional SMTP and Web Push delivery. External payloads are generic."""

import base64
import json
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlsplit

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush

EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}")
PUSH_PATHS = {
    "fcm.googleapis.com": ("/fcm/send/",),
    "updates.push.services.mozilla.com": ("/push/v1/", "/wpush/v2/"),
}


class DeliveryProblem(Exception):
    def __init__(self, code, status="retry_wait"):
        self.code = code
        self.status = status


def email_valid(address):
    return bool(address and len(address) <= 254 and EMAIL.fullmatch(address))


def delivery_settings():
    path = Path(os.environ.get("MEDIAUTO_NOTIFICATION_CONFIG_FILE")
                or Path(__file__).resolve().parents[2] / ".runtime" / "notifications.json")
    saved = {}
    try:
        info = path.stat()
        if info.st_mode & 0o077 == 0 and info.st_size <= 16_384 and path.is_file():
            data = json.loads(path.read_bytes())
            if isinstance(data, dict):
                saved = {key: value for key, value in data.items() if isinstance(value, str)}
    except (OSError, ValueError):
        pass
    return {**saved, **os.environ}


def smtp_settings():
    settings = delivery_settings()
    host = settings.get("MEDIAUTO_SMTP_HOST")
    sender = settings.get("MEDIAUTO_SMTP_FROM")
    mode = settings.get("MEDIAUTO_SMTP_TLS", "starttls")
    if not host or not email_valid(sender) or mode not in ("starttls", "ssl"):
        return None
    try:
        port = int(settings.get("MEDIAUTO_SMTP_PORT", "465" if mode == "ssl" else "587"))
    except ValueError:
        return None
    return (host, port, sender, mode, settings.get("MEDIAUTO_SMTP_USERNAME"),
            settings.get("MEDIAUTO_SMTP_PASSWORD", "")) if 1 <= port <= 65535 else None


def vapid_settings():
    settings = delivery_settings()
    filename = settings.get("MEDIAUTO_VAPID_PRIVATE_KEY")
    subject = settings.get("MEDIAUTO_VAPID_SUBJECT", "")
    if not filename or not (subject.startswith("mailto:") and email_valid(subject[7:])):
        return None
    try:
        path = Path(filename)
        if path.stat().st_mode & 0o077:
            return None
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
            return None
    except (OSError, TypeError, ValueError):
        return None
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    encoded = base64.urlsafe_b64encode(public).decode("ascii").rstrip("=")
    return str(path), subject, encoded


def valid_push_endpoint(endpoint):
    try:
        url = urlsplit(endpoint)
        prefixes = PUSH_PATHS.get(url.netloc, ())
        return (url.scheme == "https" and any(url.path.startswith(prefix) and len(url.path) > len(prefix) for prefix in prefixes)
                and bool(re.fullmatch(r"/[A-Za-z0-9_:/~-]+", url.path)) and not url.query and not url.fragment)
    except ValueError:
        return False


def push_keys_valid(data):
    try:
        def decode(key):
            return base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decode(data["p256dh"]))
        return len(decode(data["auth"])) == 16
    except ValueError:
        return False


def send_email(recipient, delivery_id):
    config = smtp_settings()
    if not config:
        raise DeliveryProblem("channel_not_configured", "blocked")
    if not email_valid(recipient):
        raise DeliveryProblem("missing_email", "blocked")
    host, port, sender, mode, username, password = config
    message = EmailMessage()
    message["From"], message["To"] = sender, recipient
    message["Subject"] = "MeDIAuto Studio notification"
    message["Message-ID"] = f"<{delivery_id}@{sender.rsplit('@', 1)[1]}>"
    message.set_content("You have a new notification. Sign in to MeDIAuto Studio to view it.")
    context = ssl.create_default_context()
    try:
        client = smtplib.SMTP_SSL(host, port, context=context, timeout=8) if mode == "ssl" else smtplib.SMTP(host, port, timeout=8)
        with client:
            if mode == "starttls":
                client.starttls(context=context)
            if username:
                client.login(username, password)
            client.send_message(message)
    except smtplib.SMTPAuthenticationError as exc:
        raise DeliveryProblem("provider_rejected", "failed") from exc
    except smtplib.SMTPRecipientsRefused as exc:
        temporary = any(400 <= result[0] < 500 for result in exc.recipients.values())
        raise DeliveryProblem("provider_unavailable" if temporary else "provider_rejected",
                              "retry_wait" if temporary else "failed") from exc
    except smtplib.SMTPResponseException as exc:
        temporary = exc.smtp_code < 500
        raise DeliveryProblem("provider_unavailable" if temporary else "provider_rejected",
                              "retry_wait" if temporary else "failed") from exc
    except (OSError, smtplib.SMTPException) as exc:
        raise DeliveryProblem("provider_unavailable") from exc


class PushSession(requests.Session):
    def __init__(self):
        super().__init__()
        self.trust_env = False

    def post(self, url, *args, **kwargs):
        if not valid_push_endpoint(url):
            raise DeliveryProblem("subscription_invalid", "blocked")
        return super().post(url, *args, **{**kwargs, "allow_redirects": False})


def send_push(subscription, delivery_id):
    config = vapid_settings()
    if not config:
        raise DeliveryProblem("channel_not_configured", "blocked")
    if not subscription:
        raise DeliveryProblem("missing_subscription", "blocked")
    filename, subject, _ = config
    try:
        with PushSession() as client:
            response = webpush(
                subscription_info=subscription, data=json.dumps({"tag": str(delivery_id)}),
                vapid_private_key=filename, vapid_claims={"sub": subject}, timeout=8, ttl=300,
                requests_session=client, headers={"Topic": delivery_id.hex},
            )
            if not 200 <= response.status_code <= 202:
                raise DeliveryProblem("provider_rejected", "failed")
    except WebPushException as exc:
        status = exc.status_code
        if status in (404, 410):
            raise DeliveryProblem("subscription_expired", "blocked") from exc
        if status is not None and status < 500 and status != 429:
            raise DeliveryProblem("provider_rejected", "failed") from exc
        raise DeliveryProblem("provider_unavailable") from exc
    except requests.RequestException as exc:
        raise DeliveryProblem("provider_unavailable") from exc
