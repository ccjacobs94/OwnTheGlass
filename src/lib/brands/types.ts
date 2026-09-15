export interface FirmwareInfo {
  version: string;
  releaseDate?: string;
  fileSize?: string;
  downloadUrl?: string;
  originalFilename?: string;
  pageUrl?: string;
}

export interface ModelValidationResult {
  isValid: boolean;
  modelCode: string;
  brand: string;
  series?: string;
  productName?: string;
  productImage?: string;
  supportUrl?: string;
  latestFirmware?: FirmwareInfo;
  allFirmwares?: FirmwareInfo[];
  errorMessage?: string;
}

export interface BrandAdapter {
  brandId: string;
  brandName: string;
  validateAndFetch(modelCode: string): Promise<ModelValidationResult>;
  fetchLatestFirmware(supportUrl: string, modelCode: string): Promise<ModelValidationResult>;
}
