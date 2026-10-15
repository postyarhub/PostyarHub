import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { LandingLayout, DashboardLayout } from './layouts/Layout';
import { PageLoading } from './components/ui';
import Campaigns from './pages/dashboard/Campaigns';

// Route-level code splitting (§82)
const Landing = lazy(() => import('./pages/Landing'));
const Terms = lazy(() => import('./pages/Terms'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Help = lazy(() => import('./pages/dashboard/Help'));
const Surveys = lazy(() => import('./pages/dashboard/Surveys'));
const AdminSurveys = lazy(() => import('./pages/admin/AdminSurveys'));
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));
const Channels = lazy(() => import('./pages/dashboard/Channels'));
const Posts = lazy(() => import('./pages/dashboard/Posts'));
const PostNew = lazy(() => import('./pages/dashboard/PostNew'));
const PostDetail = lazy(() => import('./pages/dashboard/PostDetail'));
const Bots = lazy(() => import('./pages/dashboard/Bots'));
const BotDetail = lazy(() => import('./pages/dashboard/BotDetail'));
const Workflows = lazy(() => import('./pages/dashboard/Workflows'));
const WorkflowBuilder = lazy(() => import('./pages/dashboard/WorkflowBuilder'));
const Ai = lazy(() => import('./pages/dashboard/Ai'));
const WooCommerce = lazy(() => import('./pages/dashboard/WooCommerce'));
const Gold = lazy(() => import('./pages/dashboard/Gold'));
const Analytics = lazy(() => import('./pages/dashboard/Analytics'));
const Subscription = lazy(() => import('./pages/dashboard/Subscription'));
const Wallet = lazy(() => import('./pages/dashboard/Wallet'));
const Referrals = lazy(() => import('./pages/dashboard/Referrals'));
const Notifications = lazy(() => import('./pages/dashboard/Notifications'));
const Settings = lazy(() => import('./pages/dashboard/Settings'));
const Support = lazy(() => import('./pages/dashboard/Support'));
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const AdminHome = lazy(() => import('./pages/admin/AdminHome'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminPlans = lazy(() => import('./pages/admin/AdminPlans'));
const AdminPayments = lazy(() => import('./pages/admin/AdminPayments'));
const AdminGateways = lazy(() => import('./pages/admin/AdminGateways'));
const AdminSms = lazy(() => import('./pages/admin/AdminSms'));
const AdminEmail = lazy(() => import('./pages/admin/AdminEmail'));
const AdminChannels = lazy(() => import('./pages/admin/AdminChannels'));
const AdminBots = lazy(() => import('./pages/admin/AdminBots'));
const AdminBroadcast = lazy(() => import('./pages/admin/AdminBroadcast'));
const AdminTickets = lazy(() => import('./pages/admin/AdminTickets'));
const AdminSupportTeam = lazy(() => import('./pages/admin/AdminSupportTeam'));
const AdminLogs = lazy(() => import('./pages/admin/AdminLogs'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminSettingsGeneral = lazy(() => import('./pages/admin/AdminSettingsGeneral'));
const AdminSettingsAi = lazy(() => import('./pages/admin/AdminSettingsAi'));
const AdminSettingsGold = lazy(() => import('./pages/admin/AdminSettingsGold'));
const AdminSettingsReferral = lazy(() => import('./pages/admin/AdminSettingsReferral'));
const AdminSettingsSecurity = lazy(() => import('./pages/admin/AdminSettingsSecurity'));
const PaymentResult = lazy(() => import('./pages/PaymentResult'));

const AuthEntryPage = lazy(() => import('./pages/AuthEntryPage'));

export function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<AuthEntryPage initialMode="login" />} />
        <Route path="/register" element={<AuthEntryPage initialMode="register" />} />
        <Route element={<LandingLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/payment/result" element={<PaymentResult />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="channels" element={<Channels />} />
          <Route path="posts" element={<Posts />} />
          <Route path="posts/new" element={<PostNew />} />
          <Route path="posts/:id/edit" element={<PostNew />} />
          <Route path="posts/:id" element={<PostDetail />} />
          <Route path="bots" element={<Bots />} />
          <Route path="bots/:id" element={<BotDetail />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="workflows/new" element={<WorkflowBuilder />} />
          <Route path="ai" element={<Ai />} />
          <Route path="woocommerce" element={<WooCommerce />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="surveys" element={<Surveys />} />
          <Route path="gold" element={<Gold />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="subscription" element={<Subscription />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="referrals" element={<Referrals />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="settings" element={<Settings />} />
          <Route path="support" element={<Support />} />
          <Route path="help" element={<Help />} />
        </Route>
        {/* Admin shell is a COMPLETE standalone layout (Task 17-b): mounted
            top-level so the user-dashboard chrome never renders around it.
            URLs unchanged (/dashboard/admin/…) — bookmarks keep working. */}
        <Route path="/dashboard/admin" element={<AdminLayout />}>
          <Route index element={<AdminHome />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="plans" element={<AdminPlans />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="gateways" element={<AdminGateways />} />
          <Route path="sms" element={<AdminSms />} />
          <Route path="email" element={<AdminEmail />} />
          <Route path="channels" element={<AdminChannels />} />
          <Route path="bots" element={<AdminBots />} />
          <Route path="broadcast" element={<AdminBroadcast />} />
          <Route path="tickets" element={<AdminTickets />} />
          <Route path="support-team" element={<AdminSupportTeam />} />
          <Route path="surveys" element={<AdminSurveys />} />
          <Route path="logs" element={<AdminLogs />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="settings/general" element={<AdminSettingsGeneral />} />
          <Route path="settings/ai" element={<AdminSettingsAi />} />
          <Route path="settings/gold" element={<AdminSettingsGold />} />
          <Route path="settings/referral" element={<AdminSettingsReferral />} />
          <Route path="settings/security" element={<AdminSettingsSecurity />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
