"""Validation helpers for public campaign banner media.

External references are fetched only for bounded verification. Uploaded and
WorkDrive media are copied into GridFS so public campaign documents never
retain expiring WorkDrive download URLs or large binary values.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import requests

IMAGE_LIMIT = 5 * 1024 * 1024
VIDEO_LIMIT = 100 * 1024 * 1024
PROBE_BYTES = 64 * 1024
SUPPORTED = {
    "image/jpeg": ("image", {"jpg", "jpeg"}),
    "image/png": ("image", {"png"}),
    "image/webp": ("image", {"webp"}),
    "video/mp4": ("video", {"mp4", "m4v"}),
    # Chrome/Safari commonly report the M4V container with this MIME type.
    "video/x-m4v": ("video", {"m4v"}),
    "video/quicktime": ("video", {"mov"}),
    "video/webm": ("video", {"webm"}),
}


class CampaignMediaError(ValueError):
    pass


def _safe_url(value: str) -> str:
    parts = urlsplit(str(value or "").strip())
    if (parts.scheme.lower() != "https" or not parts.hostname or parts.username or parts.password
            or parts.fragment or parts.port not in (None, 443)):
        raise CampaignMediaError("Use a public HTTPS media URL without credentials or fragments.")
    host = parts.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".test")):
        raise CampaignMediaError("Private and local media hosts are not allowed.")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and not literal.is_global:
        raise CampaignMediaError("Private and local media hosts are not allowed.")
    try:
        resolved = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise CampaignMediaError("The media host could not be resolved.") from exc
    for item in resolved:
        address = ipaddress.ip_address(item[4][0].split("%", 1)[0])
        if not address.is_global:
            raise CampaignMediaError("Private and local media hosts are not allowed.")
    return parts.geturl()


def _signature(media_type: str, content_type: str, prefix: bytes) -> bool:
    if media_type == "image":
        return ((content_type == "image/jpeg" and prefix.startswith(b"\xff\xd8\xff"))
                or (content_type == "image/png" and prefix.startswith(b"\x89PNG\r\n\x1a\n"))
                or (content_type == "image/webp" and len(prefix) >= 12 and prefix[:4] == b"RIFF" and prefix[8:12] == b"WEBP"))
    if media_type == "video":
        return ((content_type in {"video/mp4", "video/x-m4v", "video/quicktime"} and len(prefix) >= 12 and prefix[4:8] == b"ftyp")
                or (content_type == "video/webm" and prefix.startswith(b"\x1a\x45\xdf\xa3")))
    return False


def _mime_extension(content_type: str, url: str) -> tuple[str, str]:
    mime = content_type.split(";", 1)[0].strip().lower()
    if mime not in SUPPORTED:
        raise CampaignMediaError("The URL does not return a supported image or video media type.")
    media_type, extensions = SUPPORTED[mime]
    suffix = urlsplit(url).path.rsplit("/", 1)[-1].rsplit(".", 1)[-1].lower() if "." in urlsplit(url).path.rsplit("/", 1)[-1] else ""
    # MIME and file signature are authoritative; suffix is descriptive only.
    ext = suffix if suffix in extensions else sorted(extensions)[0]
    return media_type, ext


def _request_checked(session: requests.Session, method: str, url: str, **kwargs):
    current = url
    for _ in range(5):
        current = _safe_url(current)
        response = session.request(method, current, allow_redirects=False, stream=True, timeout=(5, 15), **kwargs)
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise CampaignMediaError("The media provider returned an invalid redirect.")
            current = urljoin(current, location)
            continue
        return response, current
    raise CampaignMediaError("The media URL redirects too many times.")


def verify_external_url(value: str) -> dict:
    url = _safe_url(value)
    session = requests.Session()
    session.trust_env = False
    try:
        head, final_url = _request_checked(session, "HEAD", url)
        if head.status_code in (405, 501):
            head.close()
            head = None
        elif not head.ok:
            head.close()
            raise CampaignMediaError("The media URL is inaccessible or requires private access.")
        head_type = (head.headers.get("Content-Type") or "").split(";", 1)[0].lower() if head else ""
        head_size = head.headers.get("Content-Length") if head else None
        if head:
            head.close()
        get, final_url = _request_checked(session, "GET", final_url, headers={"Range": f"bytes=0-{PROBE_BYTES - 1}"})
        try:
            if not get.ok:
                raise CampaignMediaError("The media URL is inaccessible or requires private access.")
            content_type = (get.headers.get("Content-Type") or head_type).split(";", 1)[0].lower()
            media_type, extension = _mime_extension(content_type, final_url)
            size_value = get.headers.get("Content-Range", "").rsplit("/", 1)[-1]
            if size_value.isdigit():
                size = int(size_value)
            elif get.status_code == 206:
                # A range Content-Length is only the probe length, not the media size.
                size = int(head_size or 0)
            else:
                size = int(get.headers.get("Content-Length") or head_size or 0)
            limit = IMAGE_LIMIT if media_type == "image" else VIDEO_LIMIT
            if not size:
                raise CampaignMediaError("The media provider does not report a verifiable file size.")
            if size and size > limit:
                raise CampaignMediaError("This media file exceeds the configured size limit.")
            prefix = bytearray()
            for chunk in get.iter_content(8192):
                if not chunk:
                    continue
                prefix.extend(chunk[:PROBE_BYTES - len(prefix)])
                if len(prefix) >= PROBE_BYTES:
                    break
            if not _signature(media_type, content_type, bytes(prefix)):
                raise CampaignMediaError("The response is not a valid supported media file; HTML pages are not accepted.")
            return {"url": final_url, "mediaType": media_type, "mimeType": content_type,
                    "extension": extension, "size": size or None,
                    "sourceHost": urlsplit(final_url).hostname}
        finally:
            get.close()
    except requests.RequestException as exc:
        raise CampaignMediaError("The media URL could not be verified. Check that it is public and accessible.") from exc
    finally:
        session.close()


def inspect_uploaded_media(data: bytes, declared_mime: str, filename: str) -> dict:
    mime = str(declared_mime or "").split(";", 1)[0].lower()
    if mime not in SUPPORTED:
        raise CampaignMediaError("Choose a JPG, PNG, WebP, MP4, MOV, WebM or M4V file.")
    media_type, extensions = SUPPORTED[mime]
    suffix = str(filename or "").rsplit(".", 1)[-1].lower()
    if suffix not in extensions:
        raise CampaignMediaError("The file extension does not match its declared media type.")
    limit = IMAGE_LIMIT if media_type == "image" else VIDEO_LIMIT
    if not data or len(data) > limit:
        raise CampaignMediaError("The selected media file exceeds its size limit or is empty.")
    if not _signature(media_type, mime, data[:PROBE_BYTES]):
        raise CampaignMediaError("The file contents do not match a supported media format.")
    return {"mediaType": media_type, "mimeType": mime, "extension": suffix, "size": len(data)}
