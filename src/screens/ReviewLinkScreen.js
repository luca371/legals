import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getReviewRequestPublic, submitReviewChanges, getNextReviewInBatch } from '../supabase';
import { sendReviewEmail } from '../emailApi';
import { computeChangeTokens, renderChangeTokensToHtml } from '../redlineUtils';
import './ReviewLinkScreen.css';

const LINK_EXPIRY_DAYS = 30;

function CenteredMessage({ icon, title, subtitle }) {
  return (
    <div className="rvl">
      <div className="rvl__center-card">
        {icon && <div className="rvl__center-icon">{icon}</div>}
        <h1 className="rvl__center-title">{title}</h1>
        <p className="rvl__center-subtitle">{subtitle}</p>
      </div>
    </div>
  );
}

function isExpired(createdAt) {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created > LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}

function ReviewLinkScreen() {
  const { reviewId } = useParams();
  const editableRef = useRef(null);

  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expired, setExpired] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [stage, setStage] = useState('edit'); // 'edit' | 'preview'
  const [previewTokens, setPreviewTokens] = useState(null);
  const [editedHtml, setEditedHtml] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getReviewRequestPublic(reviewId);
        setReview(data);
        if (data.status !== 'Pending') {
          setSubmitted(true);
        } else if (isExpired(data.createdAt)) {
          setExpired(true);
        }
      } catch (err) {
        console.error('Failed to load review request:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    if (reviewId) load();
  }, [reviewId]);

  const handleContinue = () => {
    if (!editableRef.current) return;
    const html = editableRef.current.innerHTML || '';
    const tokens = computeChangeTokens(review.originalHtml, html);
    setEditedHtml(html);
    setPreviewTokens(tokens);
    setStage('preview');
  };

  const handleBackToEdit = () => {
    setStage('edit');
  };

  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await submitReviewChanges(reviewId, editedHtml, previewTokens);

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
    return <CenteredMessage title="Loading…" subtitle="Fetching the document for review." />;
  }

  if (notFound) {
    return (
      <CenteredMessage
        title="Link not found"
        subtitle="This review link doesn't exist or has been removed."
      />
    );
  }

  if (expired) {
    return (
      <CenteredMessage
        title="This link has expired"
        subtitle={`Review links expire ${LINK_EXPIRY_DAYS} days after they're sent. Ask the sender for a new one.`}
      />
    );
  }

  if (submitted) {
    return review.status === 'Pending' ? (
      <CenteredMessage
        icon="✓"
        title="Changes submitted"
        subtitle="Thank you — your changes have been submitted and the sender has been notified. This link has now been used and can't be opened again."
      />
    ) : (
      <CenteredMessage
        title="This link has already been used"
        subtitle="This review link is only valid for one submission. If you need to make further changes, ask the sender for a new link."
      />
    );
  }

  return (
    <div className="rvl">
      <header className="rvl__header">
        <div>
          <h1 className="rvl__title">{review.agreementTitle}</h1>
          <p className="rvl__subtitle">
            Reviewing: {review.attachmentName}
            {review.message && <> — “{review.message}”</>}
            {review.sequence > 1 && <> · You are the next reviewer in this chain.</>}
          </p>
        </div>
        {stage === 'edit' ? (
          <button type="button" className="rvl__btn rvl__btn--primary" onClick={handleContinue}>
            Continue
          </button>
        ) : (
          <div className="rvl__header-actions">
            <button type="button" className="rvl__btn rvl__btn--secondary" onClick={handleBackToEdit} disabled={submitting}>
              Back to edit
            </button>
            <button type="button" className="rvl__btn rvl__btn--primary" onClick={handleConfirmSubmit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Confirm & submit'}
            </button>
          </div>
        )}
      </header>

      {error && <p className="rvl__error">{error}</p>}

      {stage === 'edit' ? (
        <>
          <p className="rvl__hint">
            Edit the document directly below. When you're done, click "Continue" to preview your changes with track changes before submitting.
          </p>
          <div className="rvl__doc-wrap">
            <div
              ref={editableRef}
              contentEditable
              suppressContentEditableWarning
              className="rvl__doc rvl__doc--editable"
              dangerouslySetInnerHTML={{ __html: review.originalHtml || '' }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="rvl__hint">
            This is exactly what will be submitted — deletions struck through, additions underlined. Go back to keep editing, or confirm to send it.
          </p>
          <div className="rvl__doc-wrap">
            <div
              className="rvl__doc"
              dangerouslySetInnerHTML={{ __html: renderChangeTokensToHtml(previewTokens, {}, null) }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default ReviewLinkScreen;
