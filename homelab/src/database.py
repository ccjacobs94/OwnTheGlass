import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

DB_PATH = Path("data/firmware_tracker.db")

def get_db_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Device State table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS device_state (
        device_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model_code TEXT,
        support_url TEXT,
        latest_version TEXT,
        release_date TEXT,
        file_size TEXT,
        download_url TEXT,
        product_image TEXT,
        product_name TEXT,
        available_versions_json TEXT,
        last_checked_at TEXT,
        last_updated_at TEXT,
        notified_version TEXT
    );
    """)

    # Check History table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS check_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        device_name TEXT,
        version_found TEXT,
        status TEXT NOT NULL, -- 'SUCCESS', 'ERROR', 'NEW_UPDATE', 'FIRST_SEEN'
        message TEXT,
        checked_at TEXT NOT NULL
    );
    """)

    # Notifications Log table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS notifications_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        version TEXT,
        status_code INTEGER,
        status TEXT NOT NULL, -- 'SENT', 'FAILED'
        sent_at TEXT NOT NULL
    );
    """)

    conn.commit()
    conn.close()

def get_device_state(device_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM device_state WHERE device_id = ?", (device_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        d = dict(row)
        if d.get("available_versions_json"):
            try:
                d["available_versions"] = json.loads(d["available_versions_json"])
            except Exception:
                d["available_versions"] = []
        else:
            d["available_versions"] = []
        return d
    return None

def get_all_device_states() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM device_state ORDER BY name ASC")
    rows = cursor.fetchall()
    conn.close()
    results = []
    for row in rows:
        d = dict(row)
        if d.get("available_versions_json"):
            try:
                d["available_versions"] = json.loads(d["available_versions_json"])
            except Exception:
                d["available_versions"] = []
        else:
            d["available_versions"] = []
        results.append(d)
    return results

def upsert_device_state(
    device_id: str,
    name: str,
    model_code: str,
    support_url: str,
    latest_version: Optional[str] = None,
    release_date: Optional[str] = None,
    file_size: Optional[str] = None,
    download_url: Optional[str] = None,
    product_image: Optional[str] = None,
    product_name: Optional[str] = None,
    available_versions: Optional[List[Dict[str, Any]]] = None,
    last_checked_at: Optional[str] = None,
    last_updated_at: Optional[str] = None,
    notified_version: Optional[str] = None
):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    existing = get_device_state(device_id)
    avail_json = json.dumps(available_versions) if available_versions is not None else (existing["available_versions_json"] if existing else "[]")
    
    now = datetime.now().isoformat()
    if not existing:
        cursor.execute("""
        INSERT INTO device_state (
            device_id, name, model_code, support_url, latest_version,
            release_date, file_size, download_url, product_image, product_name,
            available_versions_json, last_checked_at, last_updated_at, notified_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            device_id, name, model_code, support_url, latest_version,
            release_date, file_size, download_url, product_image, product_name,
            avail_json, last_checked_at or now, last_updated_at or now, notified_version
        ))
    else:
        cursor.execute("""
        UPDATE device_state SET
            name = COALESCE(?, name),
            model_code = COALESCE(?, model_code),
            support_url = COALESCE(?, support_url),
            latest_version = COALESCE(?, latest_version),
            release_date = COALESCE(?, release_date),
            file_size = COALESCE(?, file_size),
            download_url = COALESCE(?, download_url),
            product_image = COALESCE(?, product_image),
            product_name = COALESCE(?, product_name),
            available_versions_json = ?,
            last_checked_at = COALESCE(?, last_checked_at),
            last_updated_at = COALESCE(?, last_updated_at),
            notified_version = COALESCE(?, notified_version)
        WHERE device_id = ?
        """, (
            name, model_code, support_url, latest_version,
            release_date, file_size, download_url, product_image, product_name,
            avail_json, last_checked_at or now, last_updated_at, notified_version,
            device_id
        ))
    conn.commit()
    conn.close()

def log_check_event(device_id: str, device_name: str, version_found: str, status: str, message: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute("""
    INSERT INTO check_history (device_id, device_name, version_found, status, message, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (device_id, device_name, version_found, status, message, now))
    conn.commit()
    conn.close()

def log_notification_event(device_id: str, topic: str, title: str, message: str, version: str, status_code: int, status: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute("""
    INSERT INTO notifications_log (device_id, topic, title, message, version, status_code, status, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (device_id, topic, title, message, version, status_code, status, now))
    conn.commit()
    conn.close()

def get_check_history(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM check_history ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_notification_history(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM notifications_log ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]
