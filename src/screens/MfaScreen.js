import { useEffect, useState } from 'react';
import { supabase, logout } from '../supabase';
import './StartScreen.css';
import './MfaScreen.css';

// Shown after sign-in, before the app, when two-factor is needed:
//  - mode 'verify': the user has an authenticator set up; ask for its code.
//  - mode 'enroll': an admin without one must set it up now (QR + first code).
function MfaScreen({ mode, onDone }) {
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const prepare = async () => {
      setPreparing(true);
      setError('');
      try {
        const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
        if (listError) throw listError;

        if (mode === 'verify') {
          const totp = (factors?.totp || [])[0];
          if (!totp) throw new Error('No authenticator found for this account.');
          if (!cancelled) setFactorId(totp.id);
          return;
        }

        // Enroll: clear any half-finished setup from an earlier attempt first.
        for (const f of factors?.all || []) {
          if (f.factor_type === 'totp' && f.status !== 'verified') {
            await supabase.auth.mfa.unenroll({ factorId: f.id });
          }
        }
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
        });
        if (enrollError) throw enrollError;
        if (!cancelled) {
          setFactorId(data.id);
          setQrCode(data.totp.qr_code);
          setSecret(data.totp.secret);
        }
      } catch (err) {
        console.error('Two-factor setup failed:', err);
        if (!cancelled) setError(err.message || 'Could not start two-factor verification.');
      } finally {
        if (!cancelled) setPreparing(false);
      }
    };
    prepare();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: clean });
      if (verifyError) throw verifyError;
      onDone();
    } catch (err) {
      console.error('Two-factor verification failed:', err);
      setError('That code did not work. Check the time on your phone and try the newest code.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="start-screen">
      <div className="start-screen__left">
        <div className="start-screen__left-content">
          <h1 className="start-screen__title">Two-factor verification</h1>
          <p className="start-screen__subtitle">
            {mode === 'enroll'
              ? 'Admin accounts must use an authenticator app to sign in.'
              : 'One more step to keep your account safe.'}
          </p>
        </div>
      </div>

      <div className="start-screen__right">
        <div className="start-screen__right-content">
          <form className="login-form" onSubmit={handleSubmit}>
            <h2 className="login-form__title">
              {mode === 'enroll' ? 'Set up your authenticator' : 'Enter your code'}
            </h2>
            <p className="login-form__hint">
              {mode === 'enroll'
                ? 'Scan this QR code with Google Authenticator, Microsoft Authenticator or a similar app, then enter the 6-digit code it shows.'
                : 'Open your authenticator app and enter the 6-digit code for EsoVia.'}
            </p>

            {error && <p className="login-form__error">{error}</p>}

            {mode === 'enroll' && !preparing && qrCode && (
              <div className="mfa__qr">
                <img src={qrCode} alt="QR code for your authenticator app" width="180" height="180" />
                <p className="mfa__secret">
                  Can't scan? Enter this key manually:
                  <code>{secret}</code>
                </p>
              </div>
            )}

            <label className="login-form__label" htmlFor="mfa-code">
              Code
            </label>
            <input
              id="mfa-code"
              className="login-form__input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={preparing || !factorId}
              autoFocus
            />

            <button type="submit" className="login-form__submit" disabled={busy || preparing || !factorId}>
              {busy ? 'Checking…' : 'Continue'}
            </button>

            <button type="button" className="mfa__signout" onClick={() => logout()}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default MfaScreen;
