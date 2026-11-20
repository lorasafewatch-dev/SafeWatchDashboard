export const MAP_LAYERS = {
  standard: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    maxNativeZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxNativeZoom: 19,
  },
  topographic: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri, HERE, Garmin, USGS, and the GIS User Community',
    maxNativeZoom: 19,
  },
};

export const mapTileSources = variant => variant === 'satellite'
  ? [MAP_LAYERS.satellite, MAP_LAYERS.standard, MAP_LAYERS.topographic]
  : [MAP_LAYERS.standard, MAP_LAYERS.topographic];
