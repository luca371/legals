import { useEffect, useRef, useState } from 'react';
import mammoth from 'mammoth';
import {
  listAccounts,
  listAgreements,
  listAgreementsByAccount,
  getAgreement,
  getAccount,
} from '../firebase';
import { sendToClaudeWithTools } from '../askAiApi';
import './AskAIScreen.css';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOC_CHARS = 15000; // per document, keeps a single tool result from blowing up the context
const MAX_TOOL_ROUNDS = 6; // safety cap against a runaway tool-call loop

const STARTER_PROMPTS = [
  'How many agreements do we have in total?',
  'Which agreements are expiring in the next 90 days?',
  'List all NDAs that are still in Draft status.',
];

function uid() {
  return Math.random().toString(36).slice(2);
}

function base64ToArrayBuffer(base64) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return bytes.buffer;
}

// Attachments are stored as base64 .docx or as generated sourceHtml (see
// AgreementDetailScreen) — this pulls plain text out of either, so Claude
// can actually read clause/term content instead of just seeing metadata.
async function extractAttachmentText(attachment) {
  if (!attachment) return '';
  if (attachment.sourceHtml) {
    const div = document.createElement('div');
    div.innerHTML = attachment.sourceHtml;
    return (div.innerText || div.textContent || '').trim();
  }
  if (attachment.dataBase64 && attachment.mimeType === DOCX_MIME) {
    try {
      const arrayBuffer = base64ToArrayBuffer(attachment.dataBase64);
      const result = await mammoth.extractRawText({ arrayBuffer });
      return (result.value || '').trim();
    } catch (err) {
      console.error('Failed to extract attachment text:', err);
      return '';
    }
  }
  return '';
}

// Dispatches a tool call requested by Claude to the matching Firestore
// read, using the SAME authenticated session and security rules as the
// rest of the app — this is why the server never needs its own Firebase
// Admin credentials for Ask AI.
async function executeTool(name, input = {}) {
  try {
    switch (name) {
      case 'list_accounts': {
        const accounts = await listAccounts();
        return accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, country: a.country }));
      }
      case 'list_agreements': {
        let agreements = await listAgreements();
        if (input.accountName) {
          const q = input.accountName.toLowerCase();
          agreements = agreements.filter((a) => (a.accountName || '').toLowerCase().includes(q));
        }
        if (input.titleContains) {
          const q = input.titleContains.toLowerCase();
          agreements = agreements.filter((a) => (a.title || '').toLowerCase().includes(q));
        }
        if (input.status) {
          agreements = agreements.filter((a) => a.status === input.status);
        }
        if (input.agreementType) {
          agreements = agreements.filter((a) => a.agreementType === input.agreementType);
        }
        return agreements.map((a) => ({
          id: a.id,
          title: a.title,
          accountName: a.accountName,
          agreementType: a.agreementType,
          agreementSubtype: a.agreementSubtype,
          status: a.status,
          effectiveDate: a.effectiveDate,
          endDate: a.endDate,
        }));
      }
      case 'get_agreement_details': {
        const agreement = await getAgreement(input.agreementId);
        if (!agreement) return { error: 'Agreement not found.' };
        const documents = await Promise.all(
          (agreement.attachments || []).map(async (att) => ({
            name: att.name,
            text: (await extractAttachmentText(att)).slice(0, MAX_DOC_CHARS),
          }))
        );
        return {
          id: agreement.id,
          title: agreement.title,
          accountName: agreement.accountName,
          agreementType: agreement.agreementType,
          agreementSubtype: agreement.agreementSubtype,
          status: agreement.status,
          effectiveDate: agreement.effectiveDate,
          endDate: agreement.endDate,
          customFields: agreement.customFields || {},
          documents,
        };
      }
      case 'get_account_details': {
        const account = await getAccount(input.accountId);
        if (!account) return { error: 'Account not found.' };
        const agreements = await listAgreementsByAccount(input.accountId);
        return {
          ...account,
          agreements: agreements.map((a) => ({ id: a.id, title: a.title, status: a.status, agreementType: a.agreementType })),
        };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`Tool "${name}" failed:`, err);
    return { error: err.message || 'Tool execution failed.' };
  }
}

function describeTools(blocks) {
  const labels = blocks.map((b) => {
    switch (b.name) {
      case 'list_accounts': return 'looking up accounts';
      case 'list_agreements': return 'searching agreements';
      case 'get_agreement_details': return 'reading a contract';
      case 'get_account_details': return 'looking up an account';
      default: return 'looking something up';
    }
  });
  return `${labels.join(', ')}…`;
}

// The actual agent loop: ask Claude, and if it wants to use a tool, run it
// and feed the result back, repeating until Claude gives a final text
// answer (or the safety cap is hit).
async function runConversationTurn(startMessages, onStatus) {
  let messages = startMessages;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    onStatus(round === 0 ? 'Thinking…' : 'Thinking some more…');
    const response = await sendToClaudeWithTools(messages);
    messages = [...messages, { role: 'assistant', content: response.content }];

    if (response.stop_reason === 'tool_use') {
      const toolBlocks = response.content.filter((b) => b.type === 'tool_use');
      onStatus(describeTools(toolBlocks));
      const results = await Promise.all(
        toolBlocks.map(async (b) => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: JSON.stringify(await executeTool(b.name, b.input)),
        }))
      );
      messages = [...messages, { role: 'user', content: results }];
      continue;
    }

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n');
    return { text: text || "I couldn't come up with an answer for that.", messages };
  }
  return { text: 'This question needs more lookups than usual — try being more specific.', messages };
}

function AskAIScreen() {
  const [chatLog, setChatLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatLog, statusText]);

  const handleSend = async (overrideText) => {
    const question = (overrideText ?? input).trim();
    if (!question || sending) return;
    setInput('');
    setChatLog((prev) => [...prev, { id: uid(), role: 'user', text: question }]);
    setSending(true);
    setStatusText('Thinking…');
    try {
      const startMessages = [...history, { role: 'user', content: question }];
      const { text, messages } = await runConversationTurn(startMessages, setStatusText);
      setHistory(messages);
      setChatLog((prev) => [...prev, { id: uid(), role: 'assistant', text }]);
    } catch (err) {
      console.error('Ask AI failed:', err);
      setChatLog((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', text: `Sorry, something went wrong: ${err.message}` },
      ]);
    } finally {
      setSending(false);
      setStatusText('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = () => {
    setChatLog([]);
    setHistory([]);
  };

  return (
    <div className="ask">
      <div className="ask__header">
        <p className="ask__subtitle">Ask about any account, agreement, or contract clause across the organization.</p>
        {chatLog.length > 0 && (
          <button type="button" className="ask__new-btn" onClick={handleNewConversation}>
            New conversation
          </button>
        )}
      </div>

      <div className="ask__log" ref={scrollRef}>
        {chatLog.length === 0 ? (
          <div className="ask__empty">
            <p className="ask__empty-title">Try asking something like:</p>
            <div className="ask__suggestions">
              {STARTER_PROMPTS.map((p) => (
                <button key={p} type="button" className="ask__suggestion" onClick={() => handleSend(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chatLog.map((msg) => (
            <div key={msg.id} className={`ask__bubble-row ask__bubble-row--${msg.role}`}>
              <div className={`ask__bubble ask__bubble--${msg.role}`}>{msg.text}</div>
            </div>
          ))
        )}
        {sending && (
          <div className="ask__bubble-row ask__bubble-row--assistant">
            <div className="ask__bubble ask__bubble--assistant ask__bubble--status">
              <span className="ask__dot" />
              <span className="ask__dot" />
              <span className="ask__dot" />
              {statusText && <span className="ask__status-text">{statusText}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="ask__composer">
        <textarea
          className="ask__input"
          placeholder="Ask about your accounts, agreements, or contract clauses…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button type="button" className="ask__send-btn" onClick={() => handleSend()} disabled={!input.trim() || sending}>
          Send
        </button>
      </div>
    </div>
  );
}

export default AskAIScreen;