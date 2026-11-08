// Babel config for Metro (and, via jest-expo, for Jest).
// `inline-import` inlines the generated Drizzle `.sql` migration files into the bundle,
// which is how drizzle-orm/expo-sqlite ships migrations to the device.
module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
