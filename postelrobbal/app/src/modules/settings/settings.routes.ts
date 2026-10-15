import { FastifyInstance } from 'fastify';
import { getPaymentSettings } from '../payments/payment-settings.service.js';
import { getGeneralSettings, getSecuritySettings, getReferralSettings } from '../admin/system-settings.service.js';

/**
 * Public settings namespace.
 *
 * The application has historically received more than one registration path
 * for the public payment-settings endpoint. Fastify rejects duplicate method +
 * URL registrations during boot, which prevents the whole Passenger process
 * from starting. The payments endpoint is therefore registered only when the
 * exact public route does not already exist.
 *
 * This is deliberately limited to route registration. It does not change the
 * handler contract, payment settings, authentication, CAPTCHA, database, or
 * environment configuration.
 */
function publicGetRouteExists(app: FastifyInstance, path: string): boolean {
  return (
    app.hasRoute({ method: 'GET', url: path }) ||
    app.hasRoute({ method: 'GET', url: `/api/v1${path}` })
  );
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/settings/payments
   *
   * Public: exposes only the payment-method configuration intended for the
   * customer-facing payment selector. Card details are returned only when
   * card-to-card is enabled.
   *
   * IMPORTANT: do not register this route twice. A second registration causes
   * Fastify to throw during application bootstrap and Passenger then serves
   * HTTP 503 before any API handler (including CAPTCHA) can execute.
   */
  if (!publicGetRouteExists(app, '/settings/payments')) {
    app.get('/settings/payments', async () => {
      const s = await getPaymentSettings();
      const data: {
        onlineEnabled: boolean;
        cardToCardEnabled: boolean;
        provider: string;
        cards?: Array<{ id: string; bankName: string; cardNumber: string; holderName: string }>;
      } = {
        onlineEnabled: s.onlineEnabled,
        cardToCardEnabled: s.cardToCardEnabled,
        provider: s.provider,
      };

      if (s.cardToCardEnabled) {
        data.cards = s.cards;
      }

      return { success: true, data };
    });
  }

  // Whitelisted fields only — termsNoteFa stays admin-facing.
  // Support Telegram/Bale URLs are public contact information.
  if (!publicGetRouteExists(app, '/settings/general')) {
    app.get('/settings/general', async () => {
      const s = await getGeneralSettings();
      return {
        success: true,
        data: {
          siteNameFa: s.siteNameFa,
          siteTaglineFa: s.siteTaglineFa,
          supportEmail: s.supportEmail,
          supportPhone: s.supportPhone,
          supportTelegramUrl: s.supportTelegramUrl,
          supportBaleUrl: s.supportBaleUrl,
          maintenanceEnabled: s.maintenanceEnabled,
          maintenanceMessageFa: s.maintenanceMessageFa,
        },
      };
    });
  }

  if (!publicGetRouteExists(app, '/settings/security')) {
    app.get('/settings/security', async () => {
      const s = await getSecuritySettings();
      return {
        success: true,
        data: {
          registrationEnabled: s.registrationEnabled,
          captchaEnabled: s.captchaEnabled,
        },
      };
    });
  }

  if (!publicGetRouteExists(app, '/settings/referral')) {
    app.get('/settings/referral', async () => {
      const s = await getReferralSettings();
      return { success: true, data: { registerRewardPoints: s.registerRewardPoints } };
    });
  }
}
