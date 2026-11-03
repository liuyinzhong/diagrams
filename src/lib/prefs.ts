// Persisted view preferences and recent-files list (localStorage).

import type { DetailLevel } from "../types/layout";

const RANKDIR_KEY = "diagrams-rankdir";
const DETAIL_KEY = "diagrams-detail";
const RECENT_KEY = "diagrams-recent";
const AUTOSAVE_KEY = "diagrams-autosave";
const EXPLORER_ROOT_KEY = "diagrams-explorer-root";
const MAX_RECENT = 10;

export function loadExplorerRoot(): string | null {
  try {
    return localStorage.getItem(EXPLORER_ROOT_KEY) || null;
  } catch {
    return null;
  }
}

export function saveExplorerRoot(path: string): void {
  try {
    localStorage.setItem(EXPLORER_ROOT_KEY, path);
  } catch {
    // The current selection remains usable even when local storage is unavailable.
  }
}

export function loadAutosave(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveAutosave(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, enabled ? "on" : "off");
  } catch {
    // ignore
  }
}

export function loadRankdir(): "LR" | "RL" | "TB" {
  try {
    const v = localStorage.getItem(RANKDIR_KEY);
    if (v === "LR" || v === "RL" || v === "TB") return v;
  } catch {
    // ignore
  }
  return "LR";
}

export function saveRankdir(value: "LR" | "RL" | "TB"): void {
  try {
    localStorage.setItem(RANKDIR_KEY, value);
  } catch {
    // ignore
  }
}

export function loadDetailLevel(): DetailLevel {
  try {
    const v = localStorage.getItem(DETAIL_KEY);
    if (v === "full" || v === "keys-only" || v === "name-only") return v;
  } catch {
    // ignore
  }
  return "full";
}

export function saveDetailLevel(value: DetailLevel): void {
  try {
    localStorage.setItem(DETAIL_KEY, value);
  } catch {
    // ignore
  }
}

export function loadRecentFiles(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentFile(path: string): string[] {
  const current = loadRecentFiles().filter((p) => p !== path);
  const next = [path, ...current].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function removeRecentFile(path: string): string[] {
  const next = loadRecentFiles().filter((p) => p !== path);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
