// Helpers to pull GPS + timestamp out of the EXIF dictionary returned by expo-image-picker
// (`exif: true`). The shape differs a bit between iOS and Android, so be forgiving.

type Exif = Record<string, unknown> | null | undefined;

// Accepts a decimal number, a numeric string ("42.44"), or a DMS string ("42/1,26/1,3000/100").
function parseCoord(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value) && value.length >= 1) {
    const [d, m = 0, s = 0] = value.map(Number);
    const n = Math.abs(d) + m / 60 + s / 3600;
    return Number.isFinite(n) ? (d < 0 ? -n : n) : null;
  }
  if (typeof value === 'string') {
    if (value.includes(',') || value.includes('/')) {
      const parts = value.split(',').map((p) => {
        const [num, den] = p.split('/').map(Number);
        return den ? num / den : num;
      });
      const [d, m = 0, s = 0] = parts;
      const n = d + m / 60 + s / 3600;
      return Number.isFinite(n) ? n : null;
    }
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function readExifGps(exif: Exif): { lat: number; lng: number } | null {
  if (!exif) return null;
  const gpsBlock = (exif['{GPS}'] ?? {}) as Record<string, unknown>;

  let lat = parseCoord(exif.GPSLatitude ?? gpsBlock.Latitude);
  let lng = parseCoord(exif.GPSLongitude ?? gpsBlock.Longitude);
  if (lat == null || lng == null) return null;

  const latRef = String(exif.GPSLatitudeRef ?? gpsBlock.LatitudeRef ?? '').toUpperCase();
  const lngRef = String(exif.GPSLongitudeRef ?? gpsBlock.LongitudeRef ?? '').toUpperCase();
  if (latRef === 'S' && lat > 0) lat = -lat;
  if (lngRef === 'W' && lng > 0) lng = -lng;

  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// "2025:09:14 16:32:05" -> Date (device-local time; EXIF has no zone). Null if missing/unparseable.
export function readExifTime(exif: Exif): Date | null {
  if (!exif) return null;
  const raw = (exif.DateTimeOriginal ?? exif.DateTimeDigitized ?? exif.DateTime) as unknown;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d;
}
