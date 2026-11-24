import base64
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from requests import Response

from app.notification_transport import DeliveryProblem, send_email, send_push, smtp_settings, valid_push_endpoint


class NotificationTransportTest(TestCase):
    def test_private_delivery_file_and_environment_override(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "notifications.json"
            path.write_text('{"MEDIAUTO_SMTP_HOST":"file.example.test","MEDIAUTO_SMTP_FROM":"sender@example.test"}')
            path.chmod(0o600)
            with patch.dict(os.environ, {"MEDIAUTO_NOTIFICATION_CONFIG_FILE": str(path)}, clear=True):
                self.assertEqual(smtp_settings()[0], "file.example.test")
                with patch.dict(os.environ, {"MEDIAUTO_SMTP_HOST": "override.example.test"}):
                    self.assertEqual(smtp_settings()[0], "override.example.test")
                path.chmod(0o644)
                self.assertIsNone(smtp_settings())

    def test_smtp_uses_tls_and_generic_message(self):
        with patch.dict(os.environ, {"MEDIAUTO_SMTP_HOST": "smtp.example.test", "MEDIAUTO_SMTP_PORT": "587",
                                     "MEDIAUTO_SMTP_FROM": "sender@example.test", "MEDIAUTO_SMTP_TLS": "starttls"},
                        clear=True), patch("app.notification_transport.smtplib.SMTP") as smtp:
            client = smtp.return_value
            identifier = uuid4()
            send_email("receiver@example.test", identifier)
            smtp.assert_called_once_with("smtp.example.test", 587, timeout=8)
            client.starttls.assert_called_once()
            email = client.send_message.call_args.args[0]
            self.assertEqual(email["To"], "receiver@example.test")
            self.assertEqual(email["Message-ID"], f"<{identifier}@example.test>")
            self.assertEqual(email.get_content().strip(), "You have a new notification. Sign in to MeDIAuto Studio to view it.")

    def test_web_push_encodes_and_disables_redirects(self):
        def encoded(payload):
            return base64.urlsafe_b64encode(payload).decode().rstrip("=")

        client_key = ec.generate_private_key(ec.SECP256R1())
        public = client_key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
        )
        subscription = {"endpoint": "https://fcm.googleapis.com/fcm/send/synthetic", "keys": {
            "p256dh": encoded(public), "auth": encoded(b"0123456789abcdef"),
        }}
        with TemporaryDirectory() as folder:
            path = Path(folder) / "vapid.pem"
            path.write_bytes(ec.generate_private_key(ec.SECP256R1()).private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption(),
            ))
            path.chmod(0o600)
            provider = Response()
            provider.status_code = 201
            with patch.dict(os.environ, {"MEDIAUTO_VAPID_PRIVATE_KEY": str(path), "MEDIAUTO_VAPID_SUBJECT": "mailto:ops@example.test"},
                            clear=True), patch("requests.Session.post", return_value=provider) as post:
                identifier = uuid4()
                send_push(subscription, identifier)
                self.assertEqual(post.call_args.args[0], subscription["endpoint"])
                self.assertFalse(post.call_args.kwargs["allow_redirects"])
                headers = {key.lower(): value for key, value in post.call_args.kwargs["headers"].items()}
                self.assertEqual(headers["content-encoding"], "aes128gcm")
                self.assertEqual(headers["topic"], identifier.hex)
                self.assertNotIn(str(identifier).encode(), post.call_args.kwargs["data"])
                provider.status_code = 410
                provider._content = b""
                with self.assertRaises(DeliveryProblem) as error:
                    send_push(subscription, identifier)
                self.assertEqual(error.exception.code, "subscription_expired")

        self.assertFalse(valid_push_endpoint("https://fcm.googleapis.com/fcm/send/../../private"))
        self.assertFalse(valid_push_endpoint("https://127.0.0.1/fcm/send/token"))
        self.assertFalse(valid_push_endpoint("https://fcm.googleapis.com@internal.example.test/fcm/send/token"))
