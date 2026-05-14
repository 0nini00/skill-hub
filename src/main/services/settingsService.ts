import type { AiConfig, BackendResult } from "../../shared/types/skill";
import { runBackend } from "./backendService";

export async function getAiConfig(): Promise<AiConfig> {
  const result = await runBackend<AiConfig>(["get-ai-config"]);
  return result.data ?? {};
}

export function setAiConfig(config: Required<AiConfig>): Promise<BackendResult> {
  return runBackend([
    "set-ai-config",
    "--url",
    config.api_url,
    "--key",
    config.api_key,
    "--model",
    config.model,
    "--proxy",
    config.proxy,
  ]);
}
