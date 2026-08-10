/**
 * Link omru icin hizli secim degerleri.
 *
 * Yukleme formu ve surum duzenleme ekrani ayni listeyi kullanir; sunucudan
 * gelen `maxTtlHours` degerine gore filtrelenir. En buyuk deger sunucudaki
 * MAX_TTL_HOURS (8760 = 1 yil) ile ayni olmali.
 */
export interface SurePresti {
  readonly saat: number;
  readonly etiket: string;
}

export const SURE_ONAYARLARI: readonly SurePresti[] = [
  { saat: 6, etiket: '6 saat' },
  { saat: 24, etiket: '1 gun' },
  { saat: 72, etiket: '3 gun' },
  { saat: 168, etiket: '1 hafta' },
  { saat: 720, etiket: '30 gun' },
  { saat: 2160, etiket: '3 ay' },
  { saat: 8760, etiket: '1 yil' },
];
