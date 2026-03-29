// src/utils/leafletIconFix.js
// Leaflet's default marker icons use webpack/parcel asset paths that break under Vite.
// This fix replaces the default icon with explicit CDN URLs.
// Import this file once in any component that uses Leaflet Marker (not CircleMarker).
import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl: iconUrl,
  shadowUrl: iconShadowUrl,
});
