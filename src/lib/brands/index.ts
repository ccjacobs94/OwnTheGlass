import type { BrandAdapter } from './types';
import { LGAdapter } from './lg';

class GenericStubAdapter implements BrandAdapter {
  brandId: string;
  brandName: string;

  constructor(brandId: string, brandName: string) {
    this.brandId = brandId;
    this.brandName = brandName;
  }

  async validateAndFetch(modelCode: string) {
    return {
      isValid: false,
      brand: this.brandId,
      modelCode,
      errorMessage: `${this.brandName} adapter is currently being calibrated. For early access, submit your model to request queue.`,
    };
  }

  async fetchLatestFirmware(supportUrl: string, modelCode: string) {
    return {
      isValid: false,
      brand: this.brandId,
      modelCode,
      errorMessage: `${this.brandName} support endpoint under maintenance.`,
    };
  }
}

const adapters: Record<string, BrandAdapter> = {
  LG: new LGAdapter(),
  TCL: new GenericStubAdapter('TCL', 'TCL'),
  VIZIO: new GenericStubAdapter('VIZIO', 'Vizio'),
  SAMSUNG: new GenericStubAdapter('SAMSUNG', 'Samsung'),
  SONY: new GenericStubAdapter('SONY', 'Sony'),
};

export function getBrandAdapter(brand: string = 'LG'): BrandAdapter {
  const normalized = brand.toUpperCase();
  return adapters[normalized] || adapters.LG;
}

export function getAllSupportedBrands(): { id: string; name: string; active: boolean }[] {
  return [
    { id: 'LG', name: 'LG (OLED / QNED / NanoCell)', active: true },
    { id: 'TCL', name: 'TCL (Google TV / Roku)', active: false },
    { id: 'VIZIO', name: 'Vizio (SmartCast)', active: false },
    { id: 'SAMSUNG', name: 'Samsung (Tizen)', active: false },
    { id: 'SONY', name: 'Sony (Bravia)', active: false },
  ];
}
