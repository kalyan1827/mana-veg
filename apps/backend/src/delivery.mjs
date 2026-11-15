export const DELIVERY_RADIUS_KM = 20;

export function deliveryEligibility(dispatch, destination) {
  for (const point of [dispatch, destination]) {
    if (!Number.isFinite(point?.lat) || Math.abs(point.lat) > 90 ||
        !Number.isFinite(point?.lon) || Math.abs(point.lon) > 180) {
      throw new RangeError('A valid latitude and longitude are required');
    }
  }
  const radians = Math.PI / 180;
  const latitudeDelta = (destination.lat - dispatch.lat) * radians;
  const longitudeDelta = (destination.lon - dispatch.lon) * radians;
  const arc = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(dispatch.lat * radians) * Math.cos(destination.lat * radians) *
    Math.sin(longitudeDelta / 2) ** 2;
  const distanceKm = 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, arc)));
  return { distanceKm, eligible: distanceKm < DELIVERY_RADIUS_KM };
}
