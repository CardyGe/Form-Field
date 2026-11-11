export interface BuildInfo { version: string; build: number; commit: string; modified: boolean; date: string }
export function buildInfo(): BuildInfo;
