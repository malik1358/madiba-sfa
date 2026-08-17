function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

export function haversineDistanceKm(fromLat, fromLng, toLat, toLng) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function hasGpsCoordinates(record) {
  const latitudeRaw = record?.latitude;
  const longitudeRaw = record?.longitude;
  if (latitudeRaw === null || latitudeRaw === undefined || latitudeRaw === "") return false;
  if (longitudeRaw === null || longitudeRaw === undefined || longitudeRaw === "") return false;
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

export function captureGpsLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("Geolocation is not supported on this device."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          accuracy: Number(position.coords.accuracy.toFixed(1)),
        });
      },
      () => reject(new Error("Unable to read GPS location.")),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export function enrichVisitsWithDistances(visits) {
  const sorted = [...visits].sort(
    (left, right) => new Date(left.saved_at).getTime() - new Date(right.saved_at).getTime(),
  );

  let previousWithGps = null;

  return sorted.map((visit, index) => {
    let distanceFromPreviousKm = null;

    if (
      previousWithGps
      && hasGpsCoordinates(previousWithGps)
      && hasGpsCoordinates(visit)
    ) {
      distanceFromPreviousKm = haversineDistanceKm(
        Number(previousWithGps.latitude),
        Number(previousWithGps.longitude),
        Number(visit.latitude),
        Number(visit.longitude),
      );
    }

    if (hasGpsCoordinates(visit)) {
      previousWithGps = visit;
    }

    return {
      ...visit,
      visitSequence: index + 1,
      distanceFromPreviousKm,
      hasGps: hasGpsCoordinates(visit),
    };
  });
}

export function summarizeRouteDistanceKm(visits) {
  return enrichVisitsWithDistances(visits).reduce(
    (total, visit) => total + Number(visit.distanceFromPreviousKm || 0),
    0,
  );
}

export function buildGoogleMapsPointUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}
