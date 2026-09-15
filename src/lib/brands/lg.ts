import type { BrandAdapter, FirmwareInfo, ModelValidationResult } from './types';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function parseVersionTuple(vStr: string): number[] {
  if (!vStr) return [0, 0, 0];
  const cleanV = vStr.replace(/[^0-9\.]/g, '');
  const parts = cleanV.split('.').filter((p) => p.length > 0);
  const nums = parts.map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
  return nums.length > 0 ? nums : [0];
}

export function isNewerVersion(newV: string, oldV?: string | null): boolean {
  if (!newV) return false;
  if (!oldV) return true;

  const newTuple = parseVersionTuple(newV);
  const oldTuple = parseVersionTuple(oldV);

  const maxLen = Math.max(newTuple.length, oldTuple.length);
  for (let i = 0; i < maxLen; i++) {
    const n = newTuple[i] ?? 0;
    const o = oldTuple[i] ?? 0;
    if (n > o) return true;
    if (n < o) return false;
  }
  return false;
}

export class LGAdapter implements BrandAdapter {
  brandId = 'LG';
  brandName = 'LG Electronics';

  async fetchLatestFirmware(supportUrl: string, modelCode: string = ''): Promise<ModelValidationResult> {
    try {
      const resp = await fetch(supportUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!resp.ok) {
        return {
          isValid: false,
          brand: 'LG',
          modelCode,
          errorMessage: `LG support page returned HTTP status ${resp.status}`,
        };
      }

      const html = await resp.text();
      return this.parseLGHtml(html, supportUrl, modelCode);
    } catch (err: any) {
      return {
        isValid: false,
        brand: 'LG',
        modelCode,
        errorMessage: err.message || 'Failed to reach LG support server',
      };
    }
  }

  async validateAndFetch(rawModelCode: string): Promise<ModelValidationResult> {
    const modelCode = rawModelCode.trim().toUpperCase();
    if (!modelCode || modelCode.length < 4) {
      return {
        isValid: false,
        brand: 'LG',
        modelCode,
        errorMessage: 'Model code is too short. Example: OLED65C3PUA or OLED65CXPUA.AUS',
      };
    }

    // Try primary candidate URLs: with .AUS, without .AUS, and direct code
    const candidates: string[] = [];
    if (modelCode.includes('.')) {
      candidates.push(`https://www.lg.com/us/support/product/lg-${modelCode}`);
    } else {
      candidates.push(`https://www.lg.com/us/support/product/lg-${modelCode}.AUS`);
      candidates.push(`https://www.lg.com/us/support/product/lg-${modelCode}`);
    }

    for (const url of candidates) {
      try {
        const result = await this.fetchLatestFirmware(url, modelCode);
        if (result.isValid) {
          return result;
        }
      } catch {
        continue;
      }
    }

    return {
      isValid: false,
      brand: 'LG',
      modelCode,
      errorMessage: `Could not verify model "${modelCode}" on official LG support. Please ensure your model code is correct (found on the back of your TV or in Settings > General > About This TV).`,
    };
  }

  private parseLGHtml(html: string, supportUrl: string, modelCode: string): ModelValidationResult {
    let productName: string | undefined;
    let productImage: string | undefined;
    const allFirmwares: FirmwareInfo[] = [];

    // 1. Look for __NEXT_DATA__
    let hasValidModelData = false;
    const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/i);
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const pageProps = data.props?.pageProps || {};
        const modelData = pageProps.modelData;

        // If pageProps.modelData is missing, LG served the generic "Support Home" fallback
        if (modelData && (modelData.modelName || modelData.productName)) {
          hasValidModelData = true;
          productName = modelData.productName || modelData.friendlyName || modelData.modelName;
          productImage = modelData.imageUrl || modelData.largeImageUrl;

          const swData = pageProps.softwareData || {};
          const fileData = swData.fileData || {};

          for (const docId of Object.keys(fileData)) {
            const files = fileData[docId];
            if (Array.isArray(files)) {
              for (const f of files) {
                const orig = (f.originalFileName || '').trim();
                const lower = orig.toLowerCase();
                if (lower.includes('.zip') || lower.includes('.epk') || lower.includes('version')) {
                  const verMatch = orig.match(/Version[_\s]+([0-9\.]+)/i);
                  const version = verMatch ? verMatch[1] : orig;
                  const fileId = f.fileName;
                  const downloadUrl = fileId
                    ? `https://gscs-b2c.lge.com/downloadFile?fileId=${fileId}`
                    : undefined;

                  allFirmwares.push({
                    version,
                    originalFilename: orig,
                    releaseDate: f.releaseDate || undefined,
                    fileSize: f.fileSize || undefined,
                    downloadUrl,
                    pageUrl: supportUrl,
                  });
                }
              }
            }
          }
        }
      } catch {
        // Fall back if JSON parsing fails
      }
    }

    // 2. Fallback regex parsing ONLY if __NEXT_DATA__ had valid model data but no software data
    if (hasValidModelData && allFirmwares.length === 0) {
      const matches = Array.from(html.matchAll(/Software_File\(Version_([0-9\.]+)\)\.zip/gi));
      const seen = new Set<string>();
      for (const m of matches) {
        const v = m[1];
        if (!seen.has(v)) {
          seen.add(v);
          allFirmwares.push({
            version: v,
            originalFilename: `Software_File(Version_${v}).zip`,
            downloadUrl: supportUrl,
            pageUrl: supportUrl,
          });
        }
      }
    }

    // If no valid modelData found, this is an invalid / non-existent product page
    if (!hasValidModelData) {
      return {
        isValid: false,
        brand: 'LG',
        modelCode,
        errorMessage: `Model "${modelCode}" was not found on official LG support. Please check your model number.`,
      };
    }

    // Sort by version descending
    allFirmwares.sort((a, b) => {
      const at = parseVersionTuple(a.version);
      const bt = parseVersionTuple(b.version);
      const maxLen = Math.max(at.length, bt.length);
      for (let i = 0; i < maxLen; i++) {
        const an = at[i] ?? 0;
        const bn = bt[i] ?? 0;
        if (an > bn) return -1;
        if (an < bn) return 1;
      }
      return 0;
    });

    const latest = allFirmwares[0];

    // Infer series from modelCode / productName
    let series = 'LG TV';
    if (/CX/i.test(modelCode) || /CX/i.test(productName || '')) series = 'LG OLED CX Series';
    else if (/C1/i.test(modelCode) || /C1/i.test(productName || '')) series = 'LG OLED C1 Series';
    else if (/C2/i.test(modelCode) || /C2/i.test(productName || '')) series = 'LG OLED C2 Series';
    else if (/C3/i.test(modelCode) || /C3/i.test(productName || '')) series = 'LG OLED C3 Series';
    else if (/C4/i.test(modelCode) || /C4/i.test(productName || '')) series = 'LG OLED C4 Series';
    else if (/G3/i.test(modelCode) || /G3/i.test(productName || '')) series = 'LG OLED G3 Series';
    else if (/G4/i.test(modelCode) || /G4/i.test(productName || '')) series = 'LG OLED G4 Series';
    else if (/B4/i.test(modelCode) || /B4/i.test(productName || '')) series = 'LG OLED B4 Series';
    else if (/B3/i.test(modelCode) || /B3/i.test(productName || '')) series = 'LG OLED B3 Series';
    else if (/QNED/i.test(modelCode) || /QNED/i.test(productName || '')) series = 'LG QNED Series';
    else if (/OLED/i.test(modelCode) || /OLED/i.test(productName || '')) series = 'LG OLED Series';

    return {
      isValid: true,
      brand: 'LG',
      modelCode,
      series,
      productName: productName || `LG ${modelCode}`,
      productImage,
      supportUrl,
      latestFirmware: latest,
      allFirmwares,
    };
  }
}
