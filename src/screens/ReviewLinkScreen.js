import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getReviewRequestPublic, submitReviewChanges } from '../supabase';
import { computeRedlineHtml } from '../redlineUtils';
import './StartScreen.css';

function ReviewLinkScreen() {
  const { reviewId } = useParams();
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const editableRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getReviewRequestPublic(reviewId);
        setReview(data);
        if (data.status !== 'Pending') {
          setSubmitted(true);
        }
      } catch (err) {
        console.error('Failed to load review request:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reviewId]);

  const handleSubmit = async () => {
    if (!editableRef.current) return;
    setSubmitting(true);
    setError('');
    try {
      const finalHtml = editableRef.current.innerHTML || '';
      const redlineHtml = computeRedlineHtml(review.originalHtml, finalHtml);
      await submitReviewChanges(reviewId, finalHtml, redlineHtml);
      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit review changes:', err);
      setError('Something went wrong while submitting your changes. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="start-screen">
        <div className="start-screen__right" style={{ width: '100%' }}>
          <div className="start-screen__right-content">
            <p>Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="start-screen">
        <div className="start-screen__right" style={{ width: '100%' }}>
          <div className="start-screen__right-content">
            <h2 className="login-form__title">Link not found</h2>
            <p className="login-form__hint">This review link doesn't exist or has been removed.</p>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="start-screen">
        <div className="start-screen__right" style={{ width: '100%' }}>
          <div className="start-screen__right-content">
            <h2 className="login-form__title">
              {review.status === 'Pending' ? 'Changes submitted' : 'This link has already been used'}
            </h2>
            <p className="login-form__hint">
              {review.status === 'Pending'
                ? 'Thank you — your changes have been submitted and the sender has been notified.'
                : 'This review link is no longer active. If you need to make further changes, ask the sender for a new link.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 32px', borderBottom: '1px solid #e6e7ee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'Sora, sans-serif', color: '#001272' }}>{review.agreementTitle}</h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#6b6f86' }}>
            Reviewing: {review.attachmentName}
            {review.message && <> — "{review.message}"</>}
          </p>
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            padding: '10px 20px',
            background: '#001272',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {submitting ? 'Submitting…' : 'Submit changes'}
        </button>
      </div>

      {error && (
        <p style={{ color: '#b3261e', padding: '10px 32px', margin: 0 }}>{error}</p>
      )}

      <p style={{ padding: '12px 32px 0', fontSize: '0.82rem', color: '#9a9dae' }}>
        Edit the document directly below, then click "Submit changes" when you're done. Once submitted, this link can't be used again.
      </p>

      <div style={{ flex: 1, padding: '20px 32px 40px', overflowY: 'auto' }}>
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          style={{
            background: '#fff',
            border: '1px solid #e6e7ee',
            borderRadius: '14px',
            padding: '32px',
            maxWidth: '800px',
            margin: '0 auto',
            minHeight: '400px',
            fontSize: '0.95rem',
            lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{ __html: review.originalHtml || '' }}
        />
      </div>
    </div>
  );
}

export default ReviewLinkScreen;