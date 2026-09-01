import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getReviewRequestPublic, submitReviewChanges, getNextReviewInBatch } from '../supabase';
import { sendReviewEmail } from '../emailApi';
import { computeRedlineHtml } from '../redlineUtils';

const fontStack = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const headingFontStack = fontStack;

function CenteredMessage({ icon, title, subtitle }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f7',
        fontFamily: fontStack,
        padding: '24px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '20px',
          padding: '40px 36px',
          maxWidth: '420px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08)',
        }}
      >
        <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>{icon}</div>
        <h2
          style={{
            fontFamily: headingFontStack,
            fontWeight: 700,
            fontSize: '1.25rem',
            color: '#0071e3',
            margin: '0 0 10px',
          }}
        >
          {title}
        </h2>
        <p style={{ fontSize: '0.9rem', color: '#6e6e73', margin: 0, lineHeight: 1.6 }}>{subtitle}</p>
      </div>
    </div>
  );
}

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

      try {
        const next = await getNextReviewInBatch(review.batchId, review.sequence);
        if (next) {
          await sendReviewEmail({
            toEmail: next.reviewerEmail,
            toName: next.reviewerName,
            fromName: review.requestedBy,
            agreementTitle: review.agreementTitle,
            message: review.message,
            reviewLink: `${window.location.origin}/review/${next.id}`,
          });
        }
      } catch (chainErr) {
        console.error('Could not advance the review chain:', chainErr);
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit review changes:', err);
      setError('Something went wrong while submitting your changes. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <CenteredMessage icon="⏳" title="Loading…" subtitle="Fetching the document for review." />;
  }

  if (notFound) {
    return (
      <CenteredMessage
        icon="🔗"
        title="Link not found"
        subtitle="This review link doesn't exist or has been removed."
      />
    );
  }

  if (submitted) {
    return review.status === 'Pending' ? (
      <CenteredMessage
        title="Changes submitted"
        subtitle="Thank you — your changes have been submitted and the sender has been notified."
      />
    ) : (
      <CenteredMessage
        title="This link has already been used"
        subtitle="This review link is no longer active. If you need to make further changes, ask the sender for a new link."
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 32px', borderBottom: '1px solid rgba(0, 0, 0, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: headingFontStack, color: '#0071e3' }}>{review.agreementTitle}</h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#6e6e73' }}>
            Reviewing: {review.attachmentName}
            {review.message && <> — "{review.message}"</>}
            {review.sequence > 1 && <> · You are the next reviewer in this chain.</>}
          </p>
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            padding: '10px 20px',
            background: '#0071e3',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {submitting ? 'Submitting…' : 'Submit changes'}
        </button>
      </div>

      {error && (
        <p style={{ color: '#d92d20', padding: '10px 32px', margin: 0 }}>{error}</p>
      )}

      <p style={{ padding: '12px 32px 0', fontSize: '0.82rem', color: '#86868b' }}>
        Edit the document directly below, then click "Submit changes" when you're done. Once submitted, this link can't be used again.
      </p>

      <div style={{ flex: 1, padding: '20px 32px 40px', overflowY: 'auto' }}>
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          style={{
            background: '#fff',
            border: '1px solid rgba(0, 0, 0, 0.08)',
            borderRadius: '16px',
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