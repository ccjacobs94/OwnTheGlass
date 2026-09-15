import re
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

def parse_version_tuple(v_str: str) -> Tuple[int, ...]:
    """Parse a version string like '04.64.00' or '33.31.68' into a tuple of integers for comparison."""
    if not v_str:
        return (0, 0, 0)
    # Extract only digits and dots
    clean_v = re.sub(r'[^0-9\.]', '', v_str)
    parts = clean_v.split('.')
    res = []
    for p in parts:
        if p.isdigit():
            res.append(int(p))
    return tuple(res) if res else (0,)

def is_newer_version(new_v: str, old_v: str) -> bool:
    """Returns True if new_v is strictly greater than old_v."""
    if not old_v:
        return True
    return parse_version_tuple(new_v) > parse_version_tuple(old_v)

class LGFirmwareFetcher:
    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout
        self.headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

    async def fetch_firmware_info(self, support_url: str, model_code: str = "") -> Dict[str, Any]:
        """
        Fetches the latest firmware information from the LG support page.
        Returns a dictionary with firmware details.
        """
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True, headers=self.headers) as client:
            try:
                response = await client.get(support_url)
                response.raise_for_status()
                html_text = response.text
            except Exception as e:
                logger.error(f"Failed to fetch LG support page {support_url}: {e}")
                raise

        soup = BeautifulSoup(html_text, "html.parser")
        next_data_script = soup.find("script", id="__NEXT_DATA__")
        
        product_name = None
        product_image = None
        all_firmwares: List[Dict[str, Any]] = []

        if next_data_script and next_data_script.string:
            try:
                data = json.loads(next_data_script.string)
                page_props = data.get("props", {}).get("pageProps", {})
                
                # Extract Product Info
                model_data = page_props.get("modelData", {})
                product_name = model_data.get("productName") or model_data.get("friendlyName")
                product_image = model_data.get("imageUrl") or model_data.get("largeImageUrl")
                
                # Extract Software / Firmware Data
                sw_data = page_props.get("softwareData", {})
                file_data = sw_data.get("fileData", {})
                
                for doc_id, files in file_data.items():
                    for f in files:
                        orig = f.get("originalFileName", "")
                        if ".zip" in orig.lower() or ".epk" in orig.lower() or "version" in orig.lower():
                            ver_match = re.search(r'Version[_\s]+([0-9\.]+)', orig, re.IGNORECASE)
                            version = ver_match.group(1) if ver_match else orig
                            file_id = f.get("fileName")
                            download_url = f"https://gscs-b2c.lge.com/downloadFile?fileId={file_id}" if file_id else None
                            
                            all_firmwares.append({
                                "version": version,
                                "original_filename": orig,
                                "release_date": f.get("releaseDate"),
                                "file_size": f.get("fileSize"),
                                "download_url": download_url,
                                "doc_id": doc_id,
                                "page_url": support_url
                            })
            except Exception as json_err:
                logger.warning(f"Error parsing __NEXT_DATA__ JSON for {support_url}: {json_err}")

        # Fallback regex parsing if JSON structure was missing/changed
        if not all_firmwares:
            # Look for Version patterns in HTML
            matches = re.findall(r'Software_File\(Version_([0-9\.]+)\)\.zip', html_text, re.IGNORECASE)
            for v in set(matches):
                all_firmwares.append({
                    "version": v,
                    "original_filename": f"Software_File(Version_{v}).zip",
                    "release_date": None,
                    "file_size": None,
                    "download_url": support_url,
                    "doc_id": None,
                    "page_url": support_url
                })

        # Sort firmwares by version tuple descending
        all_firmwares.sort(key=lambda x: parse_version_tuple(x["version"]), reverse=True)

        latest = all_firmwares[0] if all_firmwares else None

        return {
            "success": True if latest else False,
            "product_name": product_name,
            "product_image": product_image,
            "latest_version": latest["version"] if latest else None,
            "release_date": latest.get("release_date") if latest else None,
            "file_size": latest.get("file_size") if latest else None,
            "download_url": latest.get("download_url") if latest else None,
            "support_url": support_url,
            "all_firmwares": all_firmwares
        }
