/**
 * Arayuzde tekrar eden bicimlendirmeler.
 */

/**
 * Saniye -> "12:34"
 * @param {number} seconds
 * @returns {string}
 */
export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
}

/**
 * 0.6234 -> "%62"
 * @param {number} ratio
 * @returns {string}
 */
export function formatPercent(ratio) {
  return "%" + Math.round((Number(ratio) || 0) * 100);
}

/**
 * 18400 -> "18.4k"
 * @param {number} value
 * @returns {string}
 */
export function formatCompact(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1000) {
    return (number / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return String(number);
}

/**
 * ISO tarih -> "3 saat once"
 * @param {string} isoDate
 * @returns {string}
 */
export function formatRelativeTime(isoDate) {
  if (!isoDate) {
    return "bilinmiyor";
  }
  const diffMs = Date.now() - new Date(isoDate).getTime();
  if (!Number.isFinite(diffMs)) {
    return "bilinmiyor";
  }

  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) {
    return "az once";
  }
  if (minutes < 60) {
    return minutes + " dk once";
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return hours + " saat once";
  }

  const days = Math.round(hours / 24);
  return days + " gun once";
}

/**
 * Bayt -> "72,4 MB"
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) {
    return "-";
  }
  const mb = value / (1024 * 1024);
  return mb.toFixed(1).replace(".", ",") + " MB";
}

/**
 * KDA orani.
 * @param {{ kills?: number, deaths?: number, assists?: number }} row
 * @returns {string}
 */
export function formatKda(row) {
  const kills = Number(row?.kills || 0);
  const deaths = Number(row?.deaths || 0);
  const assists = Number(row?.assists || 0);
  return ((kills + assists) / Math.max(1, deaths)).toFixed(2);
}
