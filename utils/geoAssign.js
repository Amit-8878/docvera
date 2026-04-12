/**
 * Lightweight GPS distance (degrees Euclidean). For small areas; upgrade to Haversine later if needed.
 * @param {{ lat?: number | null; lng?: number | null }} a
 * @param {{ lat?: number | null; lng?: number | null }} b
 * @returns {number}
 */
function getDistance(a, b) {
  if (!a || !b || a.lat == null || b.lat == null || a.lng == null || b.lng == null) {
    return Infinity;
  }
  const dx = Number(a.lat) - Number(b.lat);
  const dy = Number(a.lng) - Number(b.lng);
  return Math.sqrt(dx * dx + dy * dy);
}

module.exports = {
  getDistance,
};
