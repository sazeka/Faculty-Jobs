export const CONTINENTAL_US_BOUNDS = [
  [24.4, -125],
  [49.5, -66.5],
]

function pointCoordinates(point) {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])]
  return [Number(point?.lat), Number(point?.lng)]
}

export function isContinentalUsPoint(point) {
  const [lat, lng] = pointCoordinates(point)
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= CONTINENTAL_US_BOUNDS[0][0]
    && lat <= CONTINENTAL_US_BOUNDS[1][0]
    && lng >= CONTINENTAL_US_BOUNDS[0][1]
    && lng <= CONTINENTAL_US_BOUNDS[1][1]
}

export function overviewBoundsPoints(points = []) {
  return points.some(isContinentalUsPoint) ? CONTINENTAL_US_BOUNDS : points
}
