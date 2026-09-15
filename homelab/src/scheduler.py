import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from src.config import AppConfig, DeviceConfig
from src.fetcher import LGFirmwareFetcher, is_newer_version
from src.notifier import NtfyNotifier
from src.database import (
    get_device_state,
    upsert_device_state,
    log_check_event,
    get_all_device_states
)

logger = logging.getLogger(__name__)

class FirmwareService:
    def __init__(self, config: AppConfig):
        self.config = config
        self.fetcher = LGFirmwareFetcher()
        self.notifier = NtfyNotifier(config.ntfy)
        self.scheduler: Optional[AsyncIOScheduler] = None
        self._is_checking = False

    def update_config(self, new_config: AppConfig):
        self.config = new_config
        self.notifier.config = new_config.ntfy
        if self.scheduler:
            self.reschedule()

    async def check_single_device(self, device: DeviceConfig) -> Dict[str, Any]:
        logger.info(f"Checking firmware for {device.name} ({device.model_code})...")
        now = datetime.now().isoformat()
        try:
            info = await self.fetcher.fetch_firmware_info(device.support_url, device.model_code)
            if not info.get("success") or not info.get("latest_version"):
                msg = f"No firmware information found on support page."
                log_check_event(device.id, device.name, "N/A", "ERROR", msg)
                return {"device_id": device.id, "status": "ERROR", "message": msg}

            latest_ver = info["latest_version"]
            release_date = info.get("release_date")
            file_size = info.get("file_size")
            download_url = info.get("download_url")
            product_image = info.get("product_image")
            product_name = info.get("product_name")
            all_fw = info.get("all_firmwares", [])

            existing = get_device_state(device.id)
            
            if not existing:
                # First time seeing this device
                notified = None
                if self.config.ntfy.enabled and self.config.ntfy.notify_on_startup:
                    sent = await self.notifier.send_firmware_alert(
                        device_name=device.name,
                        device_id=device.id,
                        version=latest_ver,
                        release_date=release_date,
                        file_size=file_size,
                        download_url=download_url,
                        support_url=device.support_url,
                        is_baseline=True
                    )
                    if sent:
                        notified = latest_ver

                upsert_device_state(
                    device_id=device.id,
                    name=device.name,
                    model_code=device.model_code,
                    support_url=device.support_url,
                    latest_version=latest_ver,
                    release_date=release_date,
                    file_size=file_size,
                    download_url=download_url,
                    product_image=product_image,
                    product_name=product_name,
                    available_versions=all_fw,
                    last_checked_at=now,
                    last_updated_at=now,
                    notified_version=notified
                )

                status_type = "FIRST_SEEN"
                msg = f"Device registered with baseline version v{latest_ver}"
                log_check_event(device.id, device.name, latest_ver, status_type, msg)
                return {"device_id": device.id, "status": status_type, "version": latest_ver, "message": msg}

            else:
                old_ver = existing.get("latest_version")
                notified_ver = existing.get("notified_version")
                
                # Check if this is a newer firmware version
                has_update = is_newer_version(latest_ver, old_ver)
                
                new_notified = notified_ver
                if has_update or (self.config.ntfy.notify_on_startup and notified_ver is None):
                    sent = await self.notifier.send_firmware_alert(
                        device_name=device.name,
                        device_id=device.id,
                        version=latest_ver,
                        release_date=release_date,
                        file_size=file_size,
                        download_url=download_url,
                        support_url=device.support_url,
                        is_baseline=(notified_ver is None and not has_update)
                    )
                    if sent:
                        new_notified = latest_ver

                upsert_device_state(
                    device_id=device.id,
                    name=device.name,
                    model_code=device.model_code,
                    support_url=device.support_url,
                    latest_version=latest_ver,
                    release_date=release_date,
                    file_size=file_size,
                    download_url=download_url,
                    product_image=product_image or existing.get("product_image"),
                    product_name=product_name or existing.get("product_name"),
                    available_versions=all_fw,
                    last_checked_at=now,
                    last_updated_at=now if has_update else existing.get("last_updated_at"),
                    notified_version=new_notified
                )

                if has_update:
                    status_type = "NEW_UPDATE"
                    msg = f"New firmware found: v{latest_ver} (Previous: v{old_ver})"
                else:
                    status_type = "SUCCESS"
                    msg = f"Firmware up to date at v{latest_ver}"

                log_check_event(device.id, device.name, latest_ver, status_type, msg)
                return {"device_id": device.id, "status": status_type, "version": latest_ver, "message": msg}

        except Exception as e:
            logger.exception(f"Error checking device {device.name}: {e}")
            msg = f"Check failed: {str(e)}"
            log_check_event(device.id, device.name, "ERROR", "ERROR", msg)
            return {"device_id": device.id, "status": "ERROR", "message": msg}

    async def check_all_devices(self) -> List[Dict[str, Any]]:
        if self._is_checking:
            logger.info("Check already in progress. Skipping duplicate run.")
            return [{"status": "IN_PROGRESS", "message": "Check is already running"}]
        
        self._is_checking = True
        results = []
        try:
            for dev in self.config.devices:
                if dev.enabled:
                    res = await self.check_single_device(dev)
                    results.append(res)
        finally:
            self._is_checking = False
        return results

    def start_scheduler(self):
        if self.scheduler is None:
            self.scheduler = AsyncIOScheduler()
            interval = max(1, self.config.scheduler.interval_hours)
            self.scheduler.add_job(
                self.check_all_devices,
                IntervalTrigger(hours=interval),
                id="firmware_check_job",
                name="LG Firmware Check Job",
                replace_existing=True
            )
            self.scheduler.start()
            logger.info(f"Scheduler started. Checking every {interval} hours.")

    def reschedule(self):
        if self.scheduler and self.scheduler.running:
            interval = max(1, self.config.scheduler.interval_hours)
            self.scheduler.reschedule_job(
                "firmware_check_job",
                trigger=IntervalTrigger(hours=interval)
            )
            logger.info(f"Scheduler rescheduled for every {interval} hours.")

    def stop_scheduler(self):
        if self.scheduler and self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("Scheduler stopped.")

    def get_next_run_time(self) -> Optional[str]:
        if self.scheduler and self.scheduler.running:
            job = self.scheduler.get_job("firmware_check_job")
            if job and job.next_run_time:
                return job.next_run_time.isoformat()
        return None
