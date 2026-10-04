type FeatureFlags = {
  APP_STORE_BUILD: boolean;
  AUTO_UPDATES_ENABLED: boolean;
};

export const FEATURE_FLAGS: FeatureFlags = {
  APP_STORE_BUILD: false,
  // Enable only after owned signing and update-transaction acceptance.
  AUTO_UPDATES_ENABLED: false,
};
