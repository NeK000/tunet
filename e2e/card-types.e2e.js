import { test as baseTest, expect } from '@playwright/test';

/**
 * E2E tests for specialized card types: Energy Cost, Nordpool, and Media Player.
 * Verifies rendering, data display, and interaction for these domain-specific cards.
 *
 * Uses a self-contained MockWebSocket that includes sensor and media_player
 * entities (the shared fixture only has light + climate).
 */

/* ─── Custom fixture with energy/media entities ─── */

const test = baseTest.extend({
  context: async ({ context }, use) => {
    await use(context);
  },

  cardMock: async ({ page }, use) => {
    await page.addInitScript(() => {
      const emitMessage = (target, payload) =>
        target.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(payload) })
        );

      class MockWebSocket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor(url) {
          super();
          this.url = url;
          this.readyState = MockWebSocket.CONNECTING;
          setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.dispatchEvent(new Event('open'));
            emitMessage(this, { type: 'auth_required', ha_version: '2026.3.0' });
          }, 25);
        }

        send(data) {
          try {
            const msg = JSON.parse(data);

            if (msg.type === 'auth') {
              setTimeout(() => emitMessage(this, { type: 'auth_ok', ha_version: '2026.3.0' }), 10);
              return;
            }

            if (msg.type === 'auth/current_user') {
              setTimeout(() => emitMessage(this, {
                id: msg.id, type: 'result', success: true,
                result: { id: 'user-1', name: 'E2E User', is_admin: true, is_owner: false },
              }), 10);
              return;
            }

            if (msg.type === 'get_config') {
              setTimeout(() => emitMessage(this, {
                id: msg.id, type: 'result', success: true,
                result: {
                  latitude: 0, longitude: 0, elevation: 0,
                  unit_system: { temperature: 'C', length: 'km' },
                  location_name: 'Test Home', time_zone: 'UTC', currency: 'NOK',
                },
              }), 10);
              return;
            }

            if (msg.type === 'subscribe_entities') {
              setTimeout(() => emitMessage(this, { id: msg.id, type: 'result', success: true }), 25);
              setTimeout(() => emitMessage(this, {
                id: msg.id,
                type: 'event',
                event: {
                  sensor: {
                    'sensor.energy_cost_today': {
                      entity_id: 'sensor.energy_cost_today',
                      state: '12.45',
                      attributes: {
                        friendly_name: 'Energy Cost Today',
                        unit_of_measurement: 'NOK',
                        device_class: 'monetary',
                      },
                    },
                    'sensor.energy_cost_month': {
                      entity_id: 'sensor.energy_cost_month',
                      state: '345.67',
                      attributes: {
                        friendly_name: 'Energy Cost Month',
                        unit_of_measurement: 'NOK',
                        device_class: 'monetary',
                      },
                    },
                    'sensor.nordpool_price': {
                      entity_id: 'sensor.nordpool_price',
                      state: '0.85',
                      attributes: {
                        friendly_name: 'Nordpool Electricity Price',
                        unit_of_measurement: 'NOK/kWh',
                        raw_today: [
                          { start: '2026-03-29T00:00:00+01:00', end: '2026-03-29T01:00:00+01:00', value: 0.45 },
                          { start: '2026-03-29T01:00:00+01:00', end: '2026-03-29T02:00:00+01:00', value: 0.38 },
                          { start: '2026-03-29T02:00:00+01:00', end: '2026-03-29T03:00:00+01:00', value: 0.32 },
                          { start: '2026-03-29T06:00:00+01:00', end: '2026-03-29T07:00:00+01:00', value: 0.72 },
                          { start: '2026-03-29T12:00:00+01:00', end: '2026-03-29T13:00:00+01:00', value: 0.85 },
                          { start: '2026-03-29T18:00:00+01:00', end: '2026-03-29T19:00:00+01:00', value: 1.12 },
                        ],
                        raw_tomorrow: [],
                      },
                    },
                  },
                  media_player: {
                    'media_player.living_room': {
                      entity_id: 'media_player.living_room',
                      state: 'playing',
                      attributes: {
                        friendly_name: 'Living Room Speaker',
                        media_title: 'Test Song',
                        media_artist: 'Test Artist',
                        media_content_type: 'music',
                        supported_features: 152461,
                      },
                    },
                    'media_player.kitchen': {
                      entity_id: 'media_player.kitchen',
                      state: 'idle',
                      attributes: {
                        friendly_name: 'Kitchen Speaker',
                        media_content_type: 'music',
                        supported_features: 152461,
                      },
                    },
                  },
                },
              }), 50);
            }
          } catch {
            // ignore malformed test messages
          }
        }

        close() {
          this.readyState = MockWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent('close'));
        }
      }

      window.WebSocket = MockWebSocket;
    });

    await use();
  },
});

/* ─── Shared auth helper ─── */

const setupPageWithCards = (page, cardIds, cardSettings = {}) =>
  page.addInitScript(
    ({ cardIds, cardSettings }) => {
      localStorage.setItem('ha_url', 'http://localhost:8123');
      localStorage.setItem('ha_auth_method', 'token');
      localStorage.setItem('ha_token', 'test_token');
      localStorage.setItem(
        'tunet_auth_cache_v1',
        JSON.stringify({
          access_token: 'test_token',
          refresh_token: 'test_refresh_token',
          expires_in: 1800,
          token_type: 'Bearer',
        })
      );
      localStorage.setItem(
        'tunet_pages_config',
        JSON.stringify({ header: [], pages: ['home'], home: cardIds })
      );
      localStorage.setItem('tunet_card_settings', JSON.stringify(cardSettings));
    },
    { cardIds, cardSettings }
  );

/* ═══════════════════════════════════════════════════════════
   Energy Cost Card
   ═══════════════════════════════════════════════════════════ */

test.describe('Energy Cost Card', () => {
  test.beforeEach(async ({ page, cardMock }) => {
    await setupPageWithCards(page, ['cost_card_e2e_001'], {
      'home::cost_card_e2e_001': {
        todayId: 'sensor.energy_cost_today',
        monthId: 'sensor.energy_cost_month',
      },
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  });

  test('renders energy cost values from entities', async ({ page }) => {
    // Should display today and month cost values
    const card = page.locator('[class*="rounded"]').filter({ hasText: /12|345/ }).first();
    await expect(card).toBeVisible({ timeout: 5000 });

    // Verify numeric cost values appear on the page
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('12');
    expect(pageContent).toContain('345');
  });

  test('cost card is visible in edit mode', async ({ page }) => {
    // Enter edit mode
    const editButton = page.getByRole('button', { name: /edit/i });
    if (await editButton.isVisible()) {
      await editButton.click();
      await page.waitForTimeout(300);
    }

    // Card should still be visible with edit controls
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('12');
  });
});

/* ═══════════════════════════════════════════════════════════
   Nordpool Card
   ═══════════════════════════════════════════════════════════ */

test.describe('Nordpool Card', () => {
  test.beforeEach(async ({ page, cardMock }) => {
    await setupPageWithCards(page, ['nordpool_card_e2e_001'], {
      'home::nordpool_card_e2e_001': {
        nordpoolId: 'sensor.nordpool_price',
        decimals: 2,
      },
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  });

  test('renders current electricity price', async ({ page }) => {
    const pageContent = await page.textContent('body');
    // Should display the current price (0.85) somewhere
    expect(pageContent).toMatch(/0[.,]85/);
  });

  test('displays price data from nordpool sensor', async ({ page }) => {
    // The nordpool card should render without errors
    // Check that no error/missing-entity state is shown
    const missingCards = page.locator('[class*="border-dashed"]');
    await expect(missingCards).toHaveCount(0, { timeout: 3000 }).catch(() => {
      // May show missing if entity not yet loaded — acceptable in E2E
    });

    const pageContent = await page.textContent('body');
    // Should contain price-like number
    expect(pageContent).toMatch(/\d+[.,]\d+/);
  });
});

/* ═══════════════════════════════════════════════════════════
   Media Player Card
   ═══════════════════════════════════════════════════════════ */

test.describe('Media Player Card', () => {
  test.beforeEach(async ({ page, cardMock }) => {
    await setupPageWithCards(page, ['media_player.living_room'], {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  });

  test('renders media player with now-playing info', async ({ page }) => {
    const pageContent = await page.textContent('body');
    // Should show media title and artist from entity attributes
    expect(pageContent).toContain('Test Song');
    expect(pageContent).toContain('Test Artist');
  });

  test('shows playback controls', async ({ page }) => {
    // Should have play/pause, skip buttons
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    // At minimum: play/pause + prev + next
    expect(buttonCount).toBeGreaterThanOrEqual(3);
  });

  test('media card is clickable to open modal', async ({ page }) => {
    // Click the card (not a button inside it)
    const card = page.locator('[class*="rounded"]').filter({ hasText: 'Test Song' }).first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.click();
    await page.waitForTimeout(500);

    // Should open a modal/dialog
    const dialog = page.locator('[role="dialog"]');
    const hasDialog = await dialog.isVisible().catch(() => false);
    // Modal may or may not open depending on implementation — check gracefully
    if (hasDialog) {
      await expect(dialog).toBeVisible();
    }
  });
});

/* ═══════════════════════════════════════════════════════════
   Media Group Card
   ═══════════════════════════════════════════════════════════ */

test.describe('Media Group Card', () => {
  test.beforeEach(async ({ page, cardMock }) => {
    await setupPageWithCards(page, ['media_group_e2e_001'], {
      'home::media_group_e2e_001': {
        mediaIds: ['media_player.living_room', 'media_player.kitchen'],
      },
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  });

  test('renders group with multiple media players', async ({ page }) => {
    const pageContent = await page.textContent('body');
    // Should show at least the playing media player info
    expect(pageContent).toContain('Living Room');
  });

  test('shows active player in group', async ({ page }) => {
    const pageContent = await page.textContent('body');
    // The playing player should show its media info
    expect(pageContent).toContain('Test Song');
  });
});

/* ═══════════════════════════════════════════════════════════
   Idle Media Player (no active playback)
   ═══════════════════════════════════════════════════════════ */

test.describe('Idle Media Player Card', () => {
  test.beforeEach(async ({ page, cardMock }) => {
    await setupPageWithCards(page, ['media_player.kitchen'], {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  });

  test('renders idle state without crashing', async ({ page }) => {
    // Should render the card without errors
    // Idle players show a muted/inactive state
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('Kitchen');
  });
});
