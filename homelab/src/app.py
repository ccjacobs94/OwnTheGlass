import os
import logging
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any
from datetime import datetime

from fastapi import FastAPI, Request, Form, Body
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from src.config import load_config, save_config, AppConfig
from src.database import (
    init_db,
    get_all_device_states,
    get_device_state,
    get_check_history,
    get_notification_history
)
from src.scheduler import FirmwareService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("lg_firmware_monitor")

config: AppConfig = load_config()
service = FirmwareService(config)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing SQLite database...")
    init_db()
    
    logger.info("Starting background scheduler...")
    service.start_scheduler()

    if config.scheduler.run_on_startup:
        logger.info("Triggering initial startup firmware check in background...")
        import asyncio
        asyncio.create_task(service.check_all_devices())

    yield

    # Shutdown
    logger.info("Shutting down background scheduler...")
    service.stop_scheduler()

app = FastAPI(title="LG TV Firmware Monitor", lifespan=lifespan)
templates = Jinja2Templates(directory="src/templates")

def format_relative_time(iso_str: Optional[str]) -> str:
    if not iso_str:
        return "Never"
    try:
        dt = datetime.fromisoformat(iso_str)
        diff = datetime.now() - dt
        seconds = int(diff.total_seconds())
        if seconds < 60:
            return "Just now"
        elif seconds < 3600:
            m = seconds // 60
            return f"{m}m ago"
        elif seconds < 86400:
            h = seconds // 3600
            return f"{h}h ago"
        else:
            d = seconds // 86400
            return f"{d}d ago"
    except Exception:
        return iso_str

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def index_view(request: Request):
    # Merge config devices with database states
    merged_devices = []
    for d in config.devices:
        db_state = get_device_state(d.id) or {}
        merged_devices.append({
            "id": d.id,
            "name": d.name,
            "model_code": d.model_code,
            "region": d.region,
            "support_url": d.support_url,
            "enabled": d.enabled,
            "latest_version": db_state.get("latest_version"),
            "release_date": db_state.get("release_date"),
            "file_size": db_state.get("file_size"),
            "download_url": db_state.get("download_url"),
            "product_image": db_state.get("product_image"),
            "product_name": db_state.get("product_name"),
            "available_versions": db_state.get("available_versions", []),
            "last_checked_at": db_state.get("last_checked_at"),
            "last_checked_at_human": format_relative_time(db_state.get("last_checked_at")),
            "last_updated_at": db_state.get("last_updated_at"),
        })

    next_run = service.get_next_run_time()
    if next_run:
        try:
            next_run_dt = datetime.fromisoformat(next_run)
            next_run_formatted = next_run_dt.strftime("%b %d, %H:%M:%S")
        except Exception:
            next_run_formatted = next_run
    else:
        next_run_formatted = None

    check_history = get_check_history(limit=50)
    for h in check_history:
        h["checked_at"] = format_relative_time(h["checked_at"])

    notification_history = get_notification_history(limit=50)
    for n in notification_history:
        n["sent_at"] = format_relative_time(n["sent_at"])

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "config": config,
            "devices": merged_devices,
            "next_run": next_run_formatted,
            "check_history": check_history,
            "notification_history": notification_history
        }
    )

@app.get("/guide", response_class=HTMLResponse)
async def guide_view(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="guide.html",
        context={"config": config}
    )

@app.get("/health")
async def health_check():
    return JSONResponse(content={"status": "healthy", "service": "lg-firmware-monitor"})

@app.get("/api/devices")
async def get_devices():
    return JSONResponse(content={"devices": get_all_device_states()})

@app.get("/api/history")
async def get_history():
    return JSONResponse(content={
        "check_history": get_check_history(limit=50),
        "notification_history": get_notification_history(limit=50)
    })

@app.post("/api/check-now")
async def api_check_now():
    logger.info("Manual check-now requested via API")
    results = await service.check_all_devices()
    return JSONResponse(content={"success": True, "results": results})

@app.post("/api/send-test-ntfy")
async def api_send_test_ntfy():
    logger.info("Test NTFY notification requested via API")
    res = await service.notifier.send_test_notification()
    return JSONResponse(content=res)

class NtfyUpdatePayload(BaseModel):
    topic: str
    server_url: Optional[str] = None
    token: Optional[str] = None

@app.post("/api/config/ntfy")
async def api_update_ntfy(payload: NtfyUpdatePayload):
    global config
    config.ntfy.topic = payload.topic.strip()
    if payload.server_url:
        config.ntfy.server_url = payload.server_url.strip()
    if payload.token is not None:
        config.ntfy.token = payload.token.strip()
    
    save_config(config)
    service.update_config(config)
    logger.info(f"NTFY configuration updated: topic={config.ntfy.topic}")
    return JSONResponse(content={"success": True, "topic": config.ntfy.topic})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.app:app", host=config.server.host, port=config.server.port, reload=False)
