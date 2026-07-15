import { useState } from 'react';
import './StartScreen.css';
import { loginWithEmail, loginWithGoogle, loginWithMicrosoft } from '../firebase';

function StartScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    try {
      await loginWithEmail(email, password);
    } catch (err) {
      setError(mapAuthError(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(mapAuthError(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await loginWithMicrosoft();
    } catch (err) {
      setError(mapAuthError(err.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="start-screen">
      <div className="start-screen__left">
        <div className="start-screen__left-content">
          <img
            src="/images/logo.png"
            alt="Legal Space"
            className="start-screen__logo"
          />
          <h1 className="start-screen__title">Welcome to Legal Space</h1>
          <p className="start-screen__subtitle">
            Your official CLM tool for drafting, review and signature.
          </p>
        </div>
      </div>

      <div className="start-screen__right">
        <div className="start-screen__right-content">
          <form className="login-form" onSubmit={handleEmailLogin}>
            <h2 className="login-form__title">Sign in</h2>
            <p className="login-form__hint">Enter your details to continue</p>

            {error && <p className="login-form__error">{error}</p>}

            <label className="login-form__label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="login-form__input"
              placeholder="you@company.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label className="login-form__label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="login-form__input"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button type="submit" className="login-form__submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="login-form__divider">
              <span>or continue with</span>
            </div>

            <div className="login-form__sso">
              <button
                type="button"
                className="sso-button"
                onClick={handleMicrosoftLogin}
                disabled={loading}
              >
                <svg
                  className="sso-button__icon"
                  viewBox="0 0 21 21"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                </svg>
                <span>Log in with Microsoft</span>
              </button>

              <button
                type="button"
                className="sso-button"
                onClick={handleGoogleLogin}
                disabled={loading}
              >
                <svg
                  className="sso-button__icon"
                  viewBox="0 0 48 48"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill="#FFC107"
                    d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
                  />
                  <path
                    fill="#FF3D00"
                    d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
                  />
                  <path
                    fill="#4CAF50"
                    d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
                  />
                  <path
                    fill="#1976D2"
                    d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
                  />
                </svg>
                <span>Log in with Google</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function mapAuthError(code) {
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in window was closed before completing.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export default StartScreen;