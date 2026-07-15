import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import mammoth from 'mammoth';
import { getApprovalRequest, decideApprovalRequest } from '../firebase';
import './ApprovalScreen.css';

function base64ToArrayBuffer(base64) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return bytes.buffer;
}

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
      <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ApprovalScreen() {
  const { approvalId } = useParams();

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewError, setPreviewError] = useState('');

  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState('');
  const [decideError, setDecideError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const req = await getApprovalRequest(approvalId);
        if (!req) {
          setNotFound(true);
          return;
        }
        setRequest(req);

        if (req.sourceHtml) {
          setPreviewHtml(req.sourceHtml);
        } else if (req.attachmentDataBase64 && req.attachmentMimeType === DOCX_MIME) {
          try {
            const arrayBuffer = base64ToArrayBuffer(req.attachmentDataBase64);
            const result = await mammoth.convertToHtml({ arrayBuffer });
            setPreviewHtml(result.value);
          } catch (err) {
            console.error('Failed to preview document:', err);
            setPreviewError('Could not preview this document — you can still download it below.');
          }
        }
      } catch (err) {
        console.error('Failed to load approval request:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    if (approvalId) load();
  }, [approvalId]);

  const handleDownload = () => {
    if (!request?.attachmentDataBase64) return;
    const blob = base64ToBlob(request.attachmentDataBase64, request.attachmentMimeType || DOCX_MIME);
    downloadBlob(blob, request.attachmentName || 'document.docx');
  };

  const handleDecide = async (decision) => {
    if (deciding) return;
    if (decision === 'Rejected' && !window.confirm('Reject this document?')) return;
    setDeciding(decision);
    setDecideError('');
    try {
      await decideApprovalRequest(approvalId, decision, comment);
      setRequest((prev) => ({ ...prev, status: decision, comment, decidedAt: { seconds: Date.now() / 1000 } }));
    } catch (err) {
      console.error('Failed to record decision:', err);
      setDecideError('Something went wrong recording your decision. Please try again.');
    } finally {
      setDeciding('');
    }
  };

  if (loading) {
    return (
      <div className="appr">
        <div className="appr__card">
          <p className="appr__loading">Loading…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="appr">
        <div className="appr__card">
          <h1 className="appr__title">Link not found</h1>
          <p className="appr__subtitle">
            This approval link is invalid or no longer available. Ask the sender to resend it.
          </p>
        </div>
      </div>
    );
  }

  const isDecided = request.status !== 'Pending';

  return (
    <div className="appr">
      <div className="appr__card">
        <span className="appr__brand">Legal Space</span>
        <h1 className="appr__title">{request.agreementTitle || 'Document approval'}</h1>
        <p className="appr__subtitle">
          {request.requestedBy ? `${request.requestedBy} sent you this document for approval.` : 'You were sent this document for approval.'}
        </p>

        {request.message && <p className="appr__message">“{request.message}”</p>}

        <div className="appr__doc">
          <div className="appr__doc-header">
            <span className="appr__doc-name">{request.attachmentName || 'No document attached'}</span>
            {request.attachmentDataBase64 && (
              <button type="button" className="appr__link-btn" onClick={handleDownload}>Download</button>
            )}
          </div>
          {previewError && <p className="appr__hint">{previewError}</p>}
          {previewHtml ? (
            <div className="appr__doc-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            !previewError && !request.attachmentDataBase64 && (
              <p className="appr__hint">No document was attached to this request.</p>
            )
          )}
        </div>

        {isDecided ? (
          <div className={`appr__decision appr__decision--${request.status === 'Approved' ? 'approved' : 'rejected'}`}>
            {request.status === 'Approved' ? <CheckIcon /> : <CrossIcon />}
            <div>
              <p className="appr__decision-title">
                {request.status === 'Approved' ? 'You approved this document.' : 'You rejected this document.'}
              </p>
              {request.comment && <p className="appr__decision-comment">“{request.comment}”</p>}
            </div>
          </div>
        ) : (
          <>
            <label className="appr__label" htmlFor="comment">Comment (optional)</label>
            <textarea
              id="comment"
              className="appr__textarea"
              rows={3}
              placeholder="Add a note for the sender…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {decideError && <p className="appr__error">{decideError}</p>}
            <div className="appr__actions">
              <button
                type="button"
                className="appr__btn appr__btn--reject"
                onClick={() => handleDecide('Rejected')}
                disabled={!!deciding}
              >
                <CrossIcon /> {deciding === 'Rejected' ? 'Rejecting…' : 'Reject'}
              </button>
              <button
                type="button"
                className="appr__btn appr__btn--approve"
                onClick={() => handleDecide('Approved')}
                disabled={!!deciding}
              >
                <CheckIcon /> {deciding === 'Approved' ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ApprovalScreen;