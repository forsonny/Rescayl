import posthog from "posthog-js";

let initialized = false;
const consented = () => typeof window !== "undefined" && window.localStorage.getItem("enableContribution") === "true";

export function captureAnalytics(event: string, properties: Record<string, any>) {
  if (initialized && consented() && !posthog.has_opted_out_capturing()) posthog.capture(event, properties);
}

export function configureAnalytics(enabled: boolean) {
  if (!enabled || !consented()) {
    if (initialized) posthog.opt_out_capturing();
    return;
  }
  let active = true;
  if (!initialized) {
    posthog.init("phc_QMcmlmComdofjfaRPzoN4KV9ziV2KgOwAOVyu4J3dIc", {
      api_host: "https://us.i.posthog.com",
      person_profiles: "identified_only",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
    });
    initialized = true;
  }
  posthog.opt_in_capturing();
  void Promise.all([window.electron.getSystemInfo(), window.electron.getAppVersion()]).then(([systemInfo, appVersion]) => {
    if (!active || !consented()) return;
    posthog.register({ ...systemInfo, appVersion });
    captureAnalytics("app_launched", { ...systemInfo, appVersion });
  }).catch(error => console.error("Could not prepare contribution analytics:", error));
  return () => { active = false; posthog.opt_out_capturing(); };
}
