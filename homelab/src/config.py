import os
import yaml
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel, Field

class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8484

class SchedulerConfig(BaseModel):
    interval_hours: int = 6
    run_on_startup: bool = True

class NtfyConfig(BaseModel):
    enabled: bool = True
    server_url: str = "https://ntfy.sh"
    topic: str = "lg-firmware-alerts"
    token: Optional[str] = ""
    priority: str = "default"
    notify_on_startup: bool = True

class DeviceConfig(BaseModel):
    id: str
    name: str
    model_code: str
    support_url: str
    region: str = "US"
    enabled: bool = True

class AppConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    scheduler: SchedulerConfig = Field(default_factory=SchedulerConfig)
    ntfy: NtfyConfig = Field(default_factory=NtfyConfig)
    devices: List[DeviceConfig] = Field(default_factory=list)

CONFIG_PATH = os.getenv("CONFIG_PATH", "config.yaml")

def load_config(config_path: str = CONFIG_PATH) -> AppConfig:
    path = Path(config_path)
    if not path.exists():
        example = Path("config_example.yaml")
        if example.exists():
            return AppConfig(**yaml.safe_load(example.read_text(encoding="utf-8")))
        return AppConfig()
    
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    # Allow environment variable overrides
    if "NTFY_TOPIC" in os.environ:
        if "ntfy" not in data:
            data["ntfy"] = {}
        data["ntfy"]["topic"] = os.environ["NTFY_TOPIC"]

    if "NTFY_SERVER_URL" in os.environ:
        if "ntfy" not in data:
            data["ntfy"] = {}
        data["ntfy"]["server_url"] = os.environ["NTFY_SERVER_URL"]

    if "NTFY_TOKEN" in os.environ:
        if "ntfy" not in data:
            data["ntfy"] = {}
        data["ntfy"]["token"] = os.environ["NTFY_TOKEN"]

    if "PORT" in os.environ:
        if "server" not in data:
            data["server"] = {}
        data["server"]["port"] = int(os.environ["PORT"])

    return AppConfig(**data)

def save_config(config: AppConfig, config_path: str = CONFIG_PATH):
    path = Path(config_path)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(config.model_dump(), f, default_flow_style=False, sort_keys=False)
