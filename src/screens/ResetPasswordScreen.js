import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { updatePassword, verifyPasswordResetToken, logout, supabase, getSession } from '../supabase';
import './StartScreen.css';

const LINK_EXPIRED_MESSAGE = 'This link is invalid or has expired. Please request a new one.';

function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // The default Supabase email template (no custom SMTP configured) links
    // here with the recovered session already in the URL hash
    // (#access_token=...&type=recovery), which the supabase-js client picks
    // up on its own via detectSessionInUrl — or, if the link's token was
    // already single-use-consumed or expired, GoTrue appends
    // #error=...&error_description=... instead. If custom SMTP is set up
    // later and the template is switched to {{ .TokenHash }}, this also
    // handles a ?token_hash= query param via verifyOtp.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const hashError = hashParams.get('error_description');
    if (hashError) {
      setError(decodeURIComponent(hashError.replace(/\+/g, ' ')));
      setVerifying(false);
      return;
    }

    const tokenHash = searchParams.get('token_hash');
    if (tokenHash) {
      const type = searchParams.get('type') || 'recovery';
      verifyPasswordResetToken(tokenHash, type).then(({ error: verifyError }) => {
        if (verifyError) {
          setError(LINK_EXPIRED_MESSAGE);
        } else {
          setVerified(true);
        }
        setVerifying(false);
      });
      return;
    }

    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      setVerified(ok);
      if (!ok) setError(LINK_EXPIRED_MESSAGE);
      setVerifying(false);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        finish(true);
      }
    });

    // detectSessionInUrl may have already finished processing the hash
    // before this listener was attached, so also check directly.
    getSession().then((session) => {
      if (session) finish(true);
    });

    const timeout = setTimeout(() => finish(false), 4000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await updatePassword(password);
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await logout();
    navigate('/');
  };

  return (
    <div className="start-screen">
      <div className="start-screen__left">
        <div className="start-screen__left-content">
          <img src="/images/logo.png" alt="Legal Space" className="start-screen__logo" />
          <h1 className="start-screen__title">Set your password</h1>
          <p className="start-screen__subtitle">
            Choose a password to finish setting up your account.
          </p>
        </div>
      </div>

      <div className="start-screen__right">
        <div className="start-screen__right-content">
          <form className="login-form" onSubmit={handleSubmit}>
            <h2 className="login-form__title">New password</h2>
            <p className="login-form__hint">Enter and confirm your new password</p>

            {error && <p className="login-form__error">{error}</p>}

            <label className="login-form__label" htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              className="login-form__input"
              placeholder="••••••••"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!verified}
            />

            <label className="login-form__label" htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              className="login-form__input"
              placeholder="••••••••"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={!verified}
            />

            <button type="submit" className="login-form__submit" disabled={loading || verifying || !verified}>
              {verifying ? 'Verifying link…' : loading ? 'Saving…' : 'Set password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ResetPasswordScreen;
