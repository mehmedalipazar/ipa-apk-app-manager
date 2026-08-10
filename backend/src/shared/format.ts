/** Insan tarafindan okunabilir bicimlendirme yardimcilari. */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const birimler = ['KB', 'MB', 'GB', 'TB'];
  let deger = bytes / 1024;
  let i = 0;
  while (deger >= 1024 && i < birimler.length - 1) {
    deger /= 1024;
    i++;
  }
  return `${deger.toFixed(deger >= 100 ? 0 : 1)} ${birimler[i]}`;
}

/** Kalan sureyi "2 gun 3 saat" gibi ifade eder. Gecmisse null. */
export function formatRemaining(untilMs: number, now = Date.now()): string | null {
  const fark = untilMs - now;
  if (fark <= 0) return null;

  const dakika = Math.floor(fark / 60_000);
  const saat = Math.floor(dakika / 60);
  const gun = Math.floor(saat / 24);

  if (gun > 0) {
    const kalanSaat = saat % 24;
    return kalanSaat > 0 ? `${gun} gun ${kalanSaat} saat` : `${gun} gun`;
  }
  if (saat > 0) {
    const kalanDakika = dakika % 60;
    return kalanDakika > 0 ? `${saat} saat ${kalanDakika} dakika` : `${saat} saat`;
  }
  if (dakika > 0) return `${dakika} dakika`;
  return '1 dakikadan az';
}

const TR_TARIH = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

export function formatDateTime(ms: number): string {
  return TR_TARIH.format(new Date(ms));
}

/** HTML metin/oznitelik icine guvenle gomulecek sekilde kacislar. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
