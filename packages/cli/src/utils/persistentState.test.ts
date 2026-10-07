/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Storage, debugLogger } from '@google/gemini-cli-core';
import { PersistentState } from './persistentState.js';

vi.mock('node:fs');
vi.mock('@google/gemini-cli-core', () => ({
  Storage: {
    getGlobalGeminiDir: vi.fn(),
  },
  debugLogger: {
    warn: vi.fn(),
  },
}));

describe('PersistentState', () => {
  let persistentState: PersistentState;
  const mockDir = '/mock/dir';
  const mockFilePath = path.join(mockDir, 'state.json');

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(Storage.getGlobalGeminiDir).mockReturnValue(mockDir);
    persistentState = new PersistentState();
  });

  it('should load state from file if it exists', () => {
    const mockData = { defaultBannerShownCount: { banner1: 1 } };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

    const value = persistentState.get('defaultBannerShownCount');
    expect(value).toEqual(mockData.defaultBannerShownCount);
    expect(fs.readFileSync).toHaveBeenCalledWith(mockFilePath, 'utf-8');
  });

  it('should return undefined if key does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const value = persistentState.get('defaultBannerShownCount');
    expect(value).toBeUndefined();
  });

  it('should save state via a temp file and atomic rename', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    persistentState.set('defaultBannerShownCount', { banner1: 1 });

    expect(fs.mkdirSync).toHaveBeenCalledWith(path.normalize(mockDir), {
      recursive: true,
    });
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [tempPathArg, contentArg] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(tempPathArg).toMatch(
      new RegExp(`^${mockFilePath}\\.tmp\\.[a-f0-9-]+$`),
    );
    expect(contentArg).toBe(
      JSON.stringify({ defaultBannerShownCount: { banner1: 1 } }, null, 2),
    );
    expect(fs.renameSync).toHaveBeenCalledWith(tempPathArg, mockFilePath);
  });

  it('should handle load errors and start fresh', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Read error');
    });

    const value = persistentState.get('defaultBannerShownCount');
    expect(value).toBeUndefined();
    expect(debugLogger.warn).toHaveBeenCalled();
  });

  it('should preserve a corrupt state file instead of silently discarding it', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === mockFilePath);
    vi.mocked(fs.readFileSync).mockReturnValue('{not valid json');

    const value = persistentState.get('defaultBannerShownCount');
    expect(value).toBeUndefined();
    expect(debugLogger.warn).toHaveBeenCalled();
    expect(fs.renameSync).toHaveBeenCalledTimes(1);
    const [fromArg, toArg] = vi.mocked(fs.renameSync).mock.calls[0];
    expect(fromArg).toBe(mockFilePath);
    expect(toArg).toMatch(new RegExp(`^${mockFilePath}\\.corrupt\\.\\d+$`));
  });

  it('should handle save errors and clean up the temp file', () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => typeof p === 'string' && p.includes('.tmp.'),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('Write error');
    });

    persistentState.set('defaultBannerShownCount', { banner1: 1 });
    expect(debugLogger.warn).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
  });
});
