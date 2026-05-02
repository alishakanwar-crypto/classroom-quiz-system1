"""
DVR camera capture via Hikvision ISAPI.

Captures JPEG snapshots from Hikvision NVR/DVR systems using digest/basic auth,
with retry logic and image preprocessing for better face recognition.
"""

import asyncio
import io
import logging

import httpx
import numpy as np

try:
    from PIL import Image, ImageEnhance
except ImportError:
    Image = None
    ImageEnhance = None

logger = logging.getLogger("quiz.dvr")


async def capture_snapshot(dvr: dict, channel: int,
                           max_retries: int = 3) -> bytes | None:
    """Capture a single JPEG frame from a Hikvision DVR via ISAPI.

    Args:
        dvr: dict with keys: ip, port, username, password
        channel: camera channel number (1-based)
        max_retries: number of retry attempts on failure

    Returns:
        JPEG image bytes or None on failure
    """
    ip = dvr["ip"]
    port = dvr.get("port", 80)
    user = dvr["username"]
    pwd = dvr["password"]

    stream_channel = channel * 100 + 1
    url = (
        f"http://{ip}:{port}/ISAPI/Streaming/channels/{stream_channel}/picture"
        f"?snapShotImageType=JPEG&videoResolutionWidth=1920&videoResolutionHeight=1080"
    )

    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, auth=httpx.DigestAuth(user, pwd))
                if resp.status_code == 401:
                    resp = await client.get(url, auth=httpx.BasicAuth(user, pwd))
                if resp.status_code == 200 and resp.headers.get(
                        "content-type", "").startswith("image"):
                    return resp.content

                if attempt < max_retries - 1:
                    backoff = 2 ** attempt
                    logger.warning(
                        f"{ip} ch{channel}: HTTP {resp.status_code}, "
                        f"retrying in {backoff}s")
                    await asyncio.sleep(backoff)
                else:
                    logger.error(
                        f"Capture failed from {ip} ch{channel} after "
                        f"{max_retries} attempts: HTTP {resp.status_code}")
        except Exception as e:
            if attempt < max_retries - 1:
                backoff = 2 ** attempt
                await asyncio.sleep(backoff)
            else:
                logger.error(
                    f"Capture failed from {ip} ch{channel} after "
                    f"{max_retries} attempts: {e}")
    return None


def preprocess_snapshot(image_bytes: bytes) -> bytes:
    """Enhance DVR snapshot quality for better face/hand detection.

    Applies upscaling, contrast enhancement, and sharpening.
    """
    if Image is None or ImageEnhance is None:
        return image_bytes
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        min_dim = 1280
        if img.width < min_dim and img.height < min_dim:
            scale = min_dim / min(img.width, img.height)
            new_w = int(img.width * scale)
            new_h = int(img.height * scale)
            img = img.resize((new_w, new_h), Image.LANCZOS)

        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.3)

        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(1.5)

        enhancer = ImageEnhance.Brightness(img)
        img = enhancer.enhance(1.1)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=95)
        return buf.getvalue()
    except Exception:
        return image_bytes
