const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Export verification folders can contain Windows paths that Metro cannot watch.
config.resolver.blockList = [
  /[\\/]\.expo-export-check[\\/].*/,
  /[\\/]dist-check[\\/].*/,
  /[\\/]dist-test[\\/].*/,
];

module.exports = config;
