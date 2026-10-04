import type { DesktopAPI } from "../common/electron-api";

declare global {
  interface Window {
    electron: DesktopAPI;
  }
}
