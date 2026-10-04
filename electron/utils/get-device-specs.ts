"use strict";

import { app } from "electron";
import os from "os";
import { FEATURE_FLAGS } from "../../common/feature-flags";

export const getPlatform = () => {
  switch (os.platform()) {
    case "aix":
    case "freebsd":
    case "linux":
    case "openbsd":
    case "android":
      return "linux";
    case "darwin":
    case "sunos":
      return "mac";
    case "win32":
      return "win";
  }
};

export const getArch = () => {
  switch (os.arch()) {
    case "x64":
      return "x64";
    case "arm":
      return "arm";
    case "arm64":
      return "arm64";
  }
};

export const getAppVersion = async () => {
  return `${app.getVersion()} ${FEATURE_FLAGS.APP_STORE_BUILD ? "MAC-APP-STORE" : "FOSS"}`;
};

export const getDeviceSpecs = async () => {
  let gpuInfo;
  try {
    gpuInfo = await app.getGPUInfo("complete");
  } catch (error) {
    console.error("Failed to get GPU info:", error);
    gpuInfo = null;
  }

  const deviceSpecs = {
    platform: getPlatform(),
    release: os.release(),
    arch: getArch(),
    model: os.cpus()[0].model.trim(),
    cpuCount: os.cpus().length,
    ...(gpuInfo && { gpu: gpuInfo.gpuDevice[0] }),
  };

  return deviceSpecs;
};
