/// <reference types="vite/client" />

import type { SkillHubApi } from "@shared/types/electron-api";

declare global {
  interface Window {
    skillHub: SkillHubApi;
  }
}
