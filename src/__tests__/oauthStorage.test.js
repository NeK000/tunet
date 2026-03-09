import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOAuthTokens,
  getOAuthTokenSavedAt,
  hasOAuthTokens,
  loadTokens,
  requestTokensFromOtherTabs,
  saveTokens,
  subscribeToOAuthTokenChanges,
} from '../services/oauthStorage';

describe('oauthStorage', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
  });

  it('stores OAuth tokens in persistent browser storage', () => {
    saveTokens({ access_token: 'access-1', refresh_token: 'refresh-1' });

    expect(sessionStorage.getItem('tunet_auth_cache_v1')).toBe(
      JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1' })
    );
    expect(localStorage.getItem('tunet_auth_cache_v1')).toBe(
      JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1' })
    );
    expect(Number(sessionStorage.getItem('tunet_auth_saved_at_v1'))).toBeGreaterThan(0);
    expect(getOAuthTokenSavedAt()).toBeGreaterThan(0);
  });

  it('migrates legacy local storage OAuth tokens into the primary storage slot', () => {
    localStorage.setItem(
      'tunet_auth_cache_v1',
      JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2' })
    );

    expect(loadTokens()).toEqual({ access_token: 'access-2', refresh_token: 'refresh-2' });
    expect(sessionStorage.getItem('tunet_auth_cache_v1')).toBe(
      JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2' })
    );
    expect(localStorage.getItem('tunet_auth_cache_v1')).toBe(
      JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2' })
    );
  });

  it('clears malformed OAuth token payloads instead of keeping them around', () => {
    sessionStorage.setItem('tunet_auth_cache_v1', '{bad json');

    expect(loadTokens()).toBeUndefined();
    expect(sessionStorage.getItem('tunet_auth_cache_v1')).toBeNull();
    expect(localStorage.getItem('tunet_auth_cache_v1')).toBeNull();
  });

  it('reports OAuth availability from session-backed tokens', () => {
    sessionStorage.setItem('tunet_auth_cache_v1', JSON.stringify({ access_token: 'access-3' }));

    expect(hasOAuthTokens()).toBe(true);
  });

  it('removes OAuth tokens from all browser storage slots', () => {
    sessionStorage.setItem('tunet_auth_cache_v1', JSON.stringify({ access_token: 'access-4' }));
    localStorage.setItem('ha_oauth_tokens', JSON.stringify({ access_token: 'legacy' }));

    clearOAuthTokens();

    expect(sessionStorage.getItem('tunet_auth_cache_v1')).toBeNull();
    expect(localStorage.getItem('tunet_auth_cache_v1')).toBeNull();
    expect(sessionStorage.getItem('tunet_auth_saved_at_v1')).toBeNull();
    expect(localStorage.getItem('tunet_auth_saved_at_v1')).toBeNull();
    expect(localStorage.getItem('ha_oauth_tokens')).toBeNull();
  });

  it('hydrates OAuth tokens from another tab into session storage', async () => {
    const tokensPromise = requestTokensFromOtherTabs({ timeoutMs: 100 });

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'tunet_auth_sync_response_v1',
        newValue: JSON.stringify({
          type: 'oauth-token-response',
          tokens: { access_token: 'shared-access', refresh_token: 'shared-refresh' },
        }),
      })
    );

    await expect(tokensPromise).resolves.toEqual({
      access_token: 'shared-access',
      refresh_token: 'shared-refresh',
    });
    expect(sessionStorage.getItem('tunet_auth_cache_v1')).toBe(
      JSON.stringify({ access_token: 'shared-access', refresh_token: 'shared-refresh' })
    );
    expect(localStorage.getItem('tunet_auth_cache_v1')).toBe(
      JSON.stringify({ access_token: 'shared-access', refresh_token: 'shared-refresh' })
    );
  });

  it('notifies OAuth listeners when another tab provides tokens', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToOAuthTokenChanges(listener);
    const tokensPromise = requestTokensFromOtherTabs({ timeoutMs: 100 });

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'tunet_auth_sync_response_v1',
        newValue: JSON.stringify({
          type: 'oauth-token-response',
          tokens: { access_token: 'shared-access-2', refresh_token: 'shared-refresh-2' },
        }),
      })
    );

    await tokensPromise;

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});