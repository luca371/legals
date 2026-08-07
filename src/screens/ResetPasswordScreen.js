import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updatePassword, logout } from '../supabase';
import './StartScreen.css';

function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
            />

            <button type="submit" className="login-form__submit" disabled={loading}>
              {loading ? 'Saving…' : 'Set password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ResetPasswordScreen;