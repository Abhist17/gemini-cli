/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Storage, debugLogger } from '@google/gemini-cli-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const STATE_FILENAME = 'state.json';

interface PersistentStateData {
  defaultBannerShownCount?: Record<string, number>;
  terminalSetupPromptShown?: boolean;
  tipsShown?: number;
  hasSeenScreenReaderNudge?: boolean;
  focusUiEnabled?: boolean;
  startupWarningCounts?: Record<string, number>;
  // Add other persistent state keys here as needed
}

export class PersistentState {
  private cache: PersistentStateData | null = null;
  private filePath: string | null = null;

  private getPath(): string {
    if (!this.filePath) {
      this.filePath = path.join(Storage.getGlobalGeminiDir(), STATE_FILENAME);
    }
    return this.filePath;
  }

  private load(): PersistentStateData {
    if (this.cache) {
      return this.cache;
    }
    try {
      const filePath = this.getPath();
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          this.cache = JSON.parse(content);
        } catch (parseError) {
          debugLogger.warn(
            'Failed to parse persistent state, preserving corrupt copy:',
            parseError,
          );
          this.preserveCorruptFile(filePath);
          this.cache = {};
        }
      } else {
        this.cache = {};
      }
    } catch (error) {
      debugLogger.warn('Failed to load persistent state:', error);
      // If error reading (e.g. permission error), start fresh
      this.cache = {};
    }
    return this.cache!;
  }

  // Best-effort forensics: a truncated/corrupt state.json otherwise gets
  // silently overwritten by the next `{}` reset, losing the evidence.
  private preserveCorruptFile(filePath: string): void {
    try {
      fs.renameSync(filePath, `${filePath}.corrupt.${Date.now()}`);
    } catch {
      // Ignore — e.g. file already moved or gone.
    }
  }

  private save() {
    if (!this.cache) return;
    const filePath = this.getPath();
    // Write-then-rename so a kill/power-loss mid-write can't leave a
    // truncated state.json behind (renameSync is atomic within a filesystem).
    const tempPath = `${filePath}.tmp.${crypto.randomUUID()}`;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(tempPath, JSON.stringify(this.cache, null, 2));
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors.
        }
      }
      debugLogger.warn('Failed to save persistent state:', error);
    }
  }

  get<K extends keyof PersistentStateData>(
    key: K,
  ): PersistentStateData[K] | undefined {
    return this.load()[key];
  }

  set<K extends keyof PersistentStateData>(
    key: K,
    value: PersistentStateData[K],
  ): void {
    this.load(); // ensure loaded
    this.cache![key] = value;
    this.save();
  }
}

export const persistentState = new PersistentState();
