// 서버 혼잡(무료 한도 초과 등) 판정
import { SERVER_BUSY_KEY, SERVER_BUSY_MS } from "./config";
import { saveLocal } from "./storage";

export function isServerBusyError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === "resource-exhausted" ||
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    (err as Error)?.message === "timeout"
  );
}

export function isServerBusyNow(): boolean {
  try {
    return Number(window.localStorage.getItem(SERVER_BUSY_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

export function markServerBusy() {
  saveLocal(SERVER_BUSY_KEY, String(Date.now() + SERVER_BUSY_MS));
}
