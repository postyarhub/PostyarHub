import { FastifyInstance } from 'fastify';
import { registerAuthRoutes } from '../modules/auth/auth.routes.js';
import { registerUserRoutes } from '../modules/users/user.routes.js';
import { registerChannelRoutes } from '../modules/channels/channel.routes.js';
import { registerPostRoutes } from '../modules/publishing/post.routes.js';
import { registerSurveyRoutes } from '../modules/surveys/survey.routes.js';
import { registerFeedbackRoutes } from '../modules/feedback/feedback.routes.js';
import { registerBotRoutes } from '../modules/bots/bot.routes.js';
import { registerWorkflowRoutes } from '../modules/workflows/workflow.routes.js';
import { registerAiRoutes } from '../modules/ai/ai.routes.js';
import { registerSubscriptionRoutes } from '../modules/subscriptions/subscription.routes.js';
import { registerPaymentRoutes } from '../modules/payments/payment.routes.js';
import { registerWalletRoutes } from '../modules/wallet/wallet.routes.js';
import { registerReferralRoutes } from '../modules/referrals/referral.routes.js';
import { registerGoldRoutes } from '../modules/gold/gold.routes.js';
import { registerAnalyticsRoutes } from '../modules/analytics/analytics.routes.js';
import { registerMediaRoutes } from '../modules/media/media.routes.js';
import { registerWordpressRoutes } from '../modules/wordpress/wordpress.routes.js';
import { registerNotificationRoutes } from '../modules/notifications/notification.routes.js';
import { registerSupportRoutes } from '../modules/support/support.routes.js';
import { registerAdminRoutes } from '../modules/admin/admin.routes.js';
import { registerSettingsRoutes } from '../modules/settings/settings.routes.js';
import { registerStickerRoutes } from '../modules/stickers/sticker.routes.js';

/** Stable API namespace (§57): /api/v1 */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (v1) => {
      await registerAuthRoutes(v1);
      await registerUserRoutes(v1);
      await registerChannelRoutes(v1);
      await registerPostRoutes(v1);
      await registerSurveyRoutes(v1);
      await registerFeedbackRoutes(v1);
      await registerBotRoutes(v1);
      await registerWorkflowRoutes(v1);
      await registerAiRoutes(v1);
      await registerSubscriptionRoutes(v1);
      await registerPaymentRoutes(v1);
      await registerWalletRoutes(v1);
      await registerReferralRoutes(v1);
      await registerGoldRoutes(v1);
      await registerAnalyticsRoutes(v1);
      await registerMediaRoutes(v1);
      await registerWordpressRoutes(v1);
      await registerNotificationRoutes(v1);
      await registerSupportRoutes(v1);
      await registerAdminRoutes(v1);
      await registerSettingsRoutes(v1);
      await registerStickerRoutes(v1);
    },
    { prefix: '/api/v1' }
  );
}
