type FeatureFlags = {
  APP_STORE_BUILD: boolean;
  AUTO_UPDATES_ENABLED: boolean;
};

export const FEATURE_FLAGS: FeatureFlags = {
  APP_STORE_BUILD: false,
  // Unsigned previews use manual installation; automatic updates stay disabled.
  AUTO_UPDATES_ENABLED: false,
};
