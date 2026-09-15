import logging
from typing import Optional, Dict, Any, List
import httpx
from src.config import NtfyConfig
from src.database import log_notification_event

logger = logging.getLogger(__name__)

# Priority mappings for ntfy (1: min, 2: low, 3: default, 4: high, 5: urgent/max)
PRIORITY_MAP = {
    "min": 1,
    "low": 2,
    "default": 3,
    "high": 4,
    "urgent": 5,
    "max": 5
}

class NtfyNotifier:
    def __init__(self, config: NtfyConfig):
        self.config = config

    async def send_notification(
        self,
        device_id: str,
        title: str,
        message: str,
        version: str = "",
        click_url: Optional[str] = None,
        download_url: Optional[str] = None,
        support_url: Optional[str] = None,
        tags: Optional[List[str]] = None,
        priority: Optional[str] = None
    ) -> bool:
        if not self.config.enabled or not self.config.topic:
            logger.info("NTFY notifications are disabled or topic is empty. Skipping.")
            return False

        server = self.config.server_url.rstrip("/")
        topic = self.config.topic.strip()

        # Build NTFY JSON payload (supports full Unicode & action buttons)
        payload: Dict[str, Any] = {
            "topic": topic,
            "title": title,
            "message": message,
            "tags": tags or ["tv", "arrow_up", "sparkles"],
            "priority": PRIORITY_MAP.get((priority or self.config.priority or "default").lower(), 3)
        }

        if click_url:
            payload["click"] = click_url
        elif download_url:
            payload["click"] = download_url
        elif support_url:
            payload["click"] = support_url

        # Build NTFY Action buttons
        actions = []
        if download_url:
            actions.append({
                "action": "view",
                "label": f"Download ({version})" if version else "Download Firmware",
                "url": download_url
            })
        actions.append({
            "action": "view",
            "label": "USB Install Guide",
            "url": "https://www.lg.com/ca_en/support/product-support/troubleshoot/help-library/cs-CT52001643-20151803889491/"
        })
        if support_url:
            actions.append({
                "action": "view",
                "label": "Support Page",
                "url": support_url
            })
        if actions:
            payload["actions"] = actions

        headers = {}
        if self.config.token:
            headers["Authorization"] = f"Bearer {self.config.token}"

        status = "FAILED"
        status_code = 0
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(server, json=payload, headers=headers)
                status_code = resp.status_code
                if resp.is_success:
                    status = "SENT"
                    logger.info(f"NTFY notification sent successfully for {device_id} to topic '{topic}'")
                    log_notification_event(device_id, topic, title, message, version, status_code, status)
                    return True
                else:
                    logger.error(f"NTFY returned status {resp.status_code}: {resp.text}")
                    log_notification_event(device_id, topic, title, message, version, status_code, status)
                    return False
        except Exception as e:
            logger.error(f"Failed to send NTFY notification: {e}")
            log_notification_event(device_id, topic, title, message, version, status_code, status)
            return False

    async def send_firmware_alert(
        self,
        device_name: str,
        device_id: str,
        version: str,
        release_date: Optional[str],
        file_size: Optional[str],
        download_url: Optional[str],
        support_url: Optional[str],
        is_baseline: bool = False
    ) -> bool:
        if is_baseline:
            title = f"📺 LG Firmware Monitor: {device_name}"
            msg_lines = [
                f"Tracking initialized for {device_name}.",
                f"Current Latest Version: v{version}",
            ]
            tags = ["tv", "white_check_mark", "gear"]
        else:
            title = f"🚀 New LG Firmware Available: {device_name}"
            msg_lines = [
                f"A new firmware update has been detected for {device_name}!",
                f"Version: v{version}",
            ]
            tags = ["tv", "tada", "arrow_up"]

        if release_date:
            msg_lines.append(f"Release Date: {release_date}")
        if file_size:
            msg_lines.append(f"File Size: {file_size}")

        if download_url:
            msg_lines.append("\nTap below to download the firmware update package.")
        elif support_url:
            msg_lines.append("\nTap below to open the LG support page.")

        msg_lines.append("💾 USB Install: Extract .epk file into 'LG_DTV' folder on a FAT32/NTFS USB drive.")

        message = "\n".join(msg_lines)

        return await self.send_notification(
            device_id=device_id,
            title=title,
            message=message,
            version=version,
            download_url=download_url,
            support_url=support_url,
            tags=tags
        )

    async def send_test_notification(self) -> Dict[str, Any]:
        title = "🔔 LG TV Firmware Monitor: Test Alert"
        message = (
            "This is a test notification from your LG TV Firmware Monitor.\n"
            "If you're seeing this, your NTFY topic configuration is working perfectly! ✨"
        )
        success = await self.send_notification(
            device_id="test-system",
            title=title,
            message=message,
            version="TEST",
            click_url="http://localhost:8080",
            tags=["bell", "sparkles", "test_tube"]
        )
        return {
            "success": success,
            "topic": self.config.topic,
            "server": self.config.server_url
        }
