import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from './supabaseClient';
import Login from './Login';
import Admin from './Admin';
import ResetPassword from './ResetPassword';
import TechDashboard from './TechDashboard';
import DispatcherDashboard from './DispatcherDashboard';
import OnboardingPage from './pages/OnboardingPage.jsx';
import ActivationPage from './pages/ActivationPage.jsx';
import RepSetPasswordPage from './pages/RepSetPasswordPage.jsx';
import SalesRepDashboard from './pages/SalesRepDashboard.jsx';
import TrackingPage from './pages/TrackingPage.jsx';

const SUPABASE_URL = 'https://zmppdmfdhknnwzwdfhwf.supabase.co';

const App = () => {
  // Authentication state
  const [user, setUser] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [role, setRole] = useState(null); // 'admin' | 'owner' | 'dispatcher' | 'tech' | null
  const [techData, setTechData] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const showResetPasswordRef = useRef(false);

  // Demo mode state
  const [demoMode, setDemoMode] = useState(false);
  const [demoClientData, setDemoClientData] = useState(null);
  const [isPublicDemo, setIsPublicDemo] = useState(false);
  const [demoToken, setDemoToken] = useState(null);
  const [demoExpiresAt, setDemoExpiresAt] = useState(null);
  const [demoLoading, setDemoLoading] = useState(false);

  // Check for existing session on load
  useEffect(() => {
    // Check if this is a password reset flow
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');

    if (type === 'recovery' || type === 'invite') {
      setShowResetPassword(true);
      showResetPasswordRef.current = true;
      setAuthLoading(false);
      return;
    }

    // Check for reset-password in URL path
    if (window.location.pathname.includes('reset-password')) {
      setShowResetPassword(true);
      showResetPasswordRef.current = true;
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      // Phase 2: ?track short-circuit — no auth needed for tracking page
      if (new URLSearchParams(window.location.search).get('track')) {
        setAuthLoading(false);
        return;
      }
      if (new URLSearchParams(window.location.search).get('activate')) {
        setAuthLoading(false);
        return;
      }
      if (new URLSearchParams(window.location.search).get('rep-invite')) {
        setAuthLoading(false);
        return;
      }
      if (session?.user) setUser(session.user);
      // authLoading is set to false inside resolveRole() at each branch for authenticated users
      else setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowResetPassword(true);
        showResetPasswordRef.current = true;
        // Clear any existing user/client state so the recovery flow is clean
        setUser(null);
        setClientData(null);
        return;
      }

      // Invite link clicked — user is auto-signed-in but has no password yet
      // Show the set-password screen so they can establish their credentials
      if (event === 'SIGNED_IN' && session?.user?.invited_at && !session.user.last_sign_in_at) {
        setShowResetPassword(true);
        showResetPasswordRef.current = true;
        setUser(null);
        setClientData(null);
        return;
      }

      if (showResetPasswordRef.current) {
        return;
      }

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setClientData(null);
        setRole(null);
        setTechData(null);
        return;
      }

      setUser(session?.user || null);
      if (!session) {
        setClientData(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Check for public demo token in URL (?demo=TOKEN)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('demo');
    if (!token) return;

    setDemoLoading(true);
    // Clean up URL
    window.history.replaceState({}, '', window.location.pathname);

    const validateToken = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-demo-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data.valid) {
          setDemoClientData(data.demo_client_data);
          setDemoExpiresAt(data.expires_at);
          setDemoToken(token);
          setIsPublicDemo(true);
          setDemoMode(true);
          // Route public demo through the single authenticated render path
          // so it gets all 7 tabs (Team/Map) instead of the legacy 5-tab fork.
          setRole('owner');
        }
      } catch (err) {
        console.error('Demo token validation failed:', err);
      } finally {
        setDemoLoading(false);
        setAuthLoading(false);
      }
    };
    validateToken();
  }, []);

  // Sales rep auto-demo removed — reps now use the Show Demo button in SalesRepDashboard.

  // Role resolution — single source of truth for all auth paths
  useEffect(() => {
    if (!user) return;

    const resolveRole = async () => {
      const email = user.email;

      // Step 1: owner / admin — check clients table
      const { data: clientRecord } = await supabase
        .from('clients')
        .select('*')
        .eq('email', email)
        .maybeSingle();
      if (clientRecord) {
        setRole(clientRecord.is_admin ? 'admin' : 'owner');
        setClientData(clientRecord);
        setAuthLoading(false);
        return;
      }

      // Step 2: dispatcher — check client_staff table
      const { data: staffRecord } = await supabase
        .from('client_staff')
        .select('*')
        .eq('email', email)
        .eq('is_active', true)
        .maybeSingle();
      if (staffRecord) {
        const { data: ownerData } = await supabase
          .from('clients')
          .select('*')
          .eq('id', staffRecord.client_id)
          .single();
        setRole('dispatcher');
        setClientData(ownerData);
        setAuthLoading(false);
        return;
      }

      // Step 3: technician — check technicians table
      const { data: techRecord } = await supabase
        .from('technicians')
        .select('*')
        .eq('email', email)
        .eq('is_active', true)
        .maybeSingle();
      if (techRecord) {
        setRole('tech');
        setTechData(techRecord);
        setAuthLoading(false);
        return;
      }

      // Step 4: no match — sign out (unknown user)
      await supabase.auth.signOut();
      setAuthLoading(false);
    };

    resolveRole();
  }, [user]);

  const handleLogin = (user) => {
    setUser(user);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setClientData(null);
    setDemoMode(false);
    setDemoClientData(null);
  };

  const handleExitDemo = async () => {
    setDemoMode(false);
    setDemoClientData(null);
    setDemoExpiresAt(null);
    setDemoToken(null);
    setIsPublicDemo(false);
    // If a sales rep triggered demo, exiting returns them to SalesRepDashboard.
    // Public demo viewers are just unauthenticated — no action needed.
  };

  // ── Public tracking route (no auth required) ──────────────
  const trackToken = new URLSearchParams(window.location.search).get('track');
  if (trackToken) return <TrackingPage token={trackToken} />;

  // ── Public onboarding route (no auth required) ──────────────
  const _onboardParams = new URLSearchParams(window.location.search);
  const _onboardToken = _onboardParams.get('token');
  if (_onboardToken) {
    return <OnboardingPage token={_onboardToken} />;
  }

  // ── Public activation route (no auth required) ──────────────
  const _activateToken = _onboardParams.get('activate');
  if (_activateToken) {
    return <ActivationPage activationToken={_activateToken} paid={_onboardParams.has('paid')} />;
  }

  const _repInviteToken = _onboardParams.get('rep-invite');
  if (_repInviteToken) {
    return <RepSetPasswordPage repInviteToken={_repInviteToken} />;
  }

  // Show loading while checking auth or demo token
  if (authLoading || demoLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Public demo mode — no login required
  if (isPublicDemo && demoMode && demoClientData) {
    return (
      <DispatcherDashboard
        user={user}
        clientData={clientData}
        role={role}
        demoMode={demoMode}
        demoClientData={demoClientData}
        isPublicDemo={isPublicDemo}
        demoToken={demoToken}
        demoExpiresAt={demoExpiresAt}
        onLogout={handleLogout}
        onShowAdmin={() => setShowAdmin(true)}
        onExitDemo={handleExitDemo}
        onSetClientData={setClientData}
      />
    );
  }

  // Show password reset form
  if (showResetPassword) {
    return (
      <ResetPassword
        onComplete={() => {
          setShowResetPassword(false);
          showResetPasswordRef.current = false;
          window.location.href = window.location.origin;
        }}
      />
    );
  }

  // Show login if not authenticated
  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  // Tech view — hard return before clientData null check and subscription gate
  if (role === 'tech' && techData) {
    return <TechDashboard techData={techData} />;
  }

  // User is authenticated but no client record — show message and sign out option
  if (user && !clientData) {
    const logo = new URL('./assets/RELIANT SUPPORT LOGO.svg', import.meta.url).href;
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 w-full max-w-md text-center">
          <img src={logo} alt="Reliant Support" style={{ height: '40px', width: 'auto' }} className="mx-auto mb-6" />
          <h2 className="text-xl font-bold text-white mb-3">No Account Found</h2>
          <p className="text-gray-400 mb-6">
            Your login credentials are valid, but no client account is set up yet.
            Please contact your administrator for an invitation.
          </p>
          <button
            onClick={handleLogout}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // ── Sales Rep Dashboard ─────────────────────────────────────────
  // If the logged-in user is a sales rep, render the rep dashboard.
  // In demo mode (triggered by Show Demo button), fall through to the
  // main demo view below by skipping this block.
  if (clientData?.is_sales_rep && !demoMode) {
    const handleShowDemo = async () => {
      // Fetch the demo client (uses demo_client_id from rep's record, or falls back to client id 9)
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientData.demo_client_id || 9)
        .single();
      if (data) {
        setDemoClientData(data);
        setDemoExpiresAt(new Date(Date.now() + 60 * 60 * 1000).toISOString());
        setDemoMode(true);
        setIsPublicDemo(false);
      }
    };

    return (
      <SalesRepDashboard
        clientData={clientData}
        onLogout={handleLogout}
        onShowDemo={handleShowDemo}
      />
    );
  }
  // ── End Sales Rep Dashboard ─────────────────────────────────────

  // Show admin dashboard if admin and showAdmin is true
  if (showAdmin && clientData?.is_admin) {
    return <Admin onBack={() => setShowAdmin(false)} />;
  }

  // Route to DispatcherDashboard for all remaining authenticated cases
  // (subscription gate and full dashboard are both handled inside DispatcherDashboard)
  return (
    <DispatcherDashboard
      user={user}
      clientData={clientData}
      role={role}
      demoMode={demoMode}
      demoClientData={demoClientData}
      isPublicDemo={isPublicDemo}
      demoToken={demoToken}
      demoExpiresAt={demoExpiresAt}
      onLogout={handleLogout}
      onShowAdmin={() => setShowAdmin(true)}
      onExitDemo={handleExitDemo}
      onSetClientData={setClientData}
    />
  );
};

export default App;
