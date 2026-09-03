import { useEffect, useRef, useState } from 'react';
import mammoth from 'mammoth';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  listAccounts,
  listAgreements,
  listAgreementsByAccount,
  getAgreement,
  getAccount,
  listAskAiConversations,
  getAskAiConversation,
  saveAskAiConversation,
  deleteAskAiConversation,
} from '../supabase';
import { sendToClaudeWithTools } from '../askAiApi';
import { semanticSearch } from '../embeddingsApi';
import './AskAIScreen.css';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOC_CHARS = 15000; 
const MAX_TOOL_ROUNDS = 6; 

const STARTER_PROMPTS = [
  'How many agreements do we have in total?',
  'Which agreements are expiring in the next 90 days?',
  'List all NDAs that are still in Draft status.',
];

const QUICK_PROMPTS = [
  { label: 'Summarize', prompt: 'Give me a summary of all our active agreements and their current statuses.' },
  { label: 'Find risks', prompt: 'Are there any agreements with unusual or risky terms I should be aware of?' },
  { label: 'Draft clause', prompt: 'Help me draft a standard confidentiality clause I could add to a contract.' },
];

const MARKDOWN_COMPONENTS = {
  table: ({ children }) => (
    <div className="ask__markdown-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

function uid() {
  return Math.random().toString(36).slice(2);
}

function deriveTitle(question) {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(isoString).toLocaleDateString();
}

function base64ToArrayBuffer(base64) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return bytes.buffer;
}

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
          createdBy: a.createdBy,
          createdAt: a.createdAt,
        }));
      }
      case 'search_agreements_semantic': {
        if (!input.query) return { error: 'query is required.' };
        try {
          return await semanticSearch(input.query, 'agreement');
        } catch (err) {
          return { error: err.message || 'Semantic search failed.', hint: 'This agreement may not be indexed yet - try list_agreements instead, or ask the user to run Reindex from Settings.' };
        }
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
          createdBy: agreement.createdBy,
          createdAt: agreement.createdAt,
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
      case 'search_agreements_semantic': return 'searching by meaning';
      case 'get_agreement_details': return 'reading a contract';
      case 'get_account_details': return 'looking up an account';
      default: return 'looking something up';
    }
  });
  return `${labels.join(', ')}…`;
}

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
  return { text: 'This question needs more lookups than usual - try being more specific.', messages };
}

function AskAIScreen() {
  const [chatLog, setChatLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const scrollRef = useRef(null);

  const [conversationId, setConversationId] = useState(null);
  const [conversationTitle, setConversationTitle] = useState('');
  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);

  const loadConversations = async () => {
    setLoadingConversations(true);
    try {
      setConversations(await listAskAiConversations());
    } catch (err) {
      console.error('Failed to load Ask AI history:', err);
    } finally {
      setLoadingConversations(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatLog, statusText]);

  const handleSend = async (overrideText) => {
    const question = (overrideText ?? input).trim();
    if (!question || sending) return;
    setInput('');
    const nextChatLog = [...chatLog, { id: uid(), role: 'user', text: question }];
    setChatLog(nextChatLog);
    setSending(true);
    setStatusText('Thinking…');
    try {
      const startMessages = [...history, { role: 'user', content: question }];
      const { text, messages } = await runConversationTurn(startMessages, setStatusText);
      setHistory(messages);
      const finalChatLog = [...nextChatLog, { id: uid(), role: 'assistant', text }];
      setChatLog(finalChatLog);

      const title = conversationTitle || deriveTitle(question);
      if (!conversationTitle) setConversationTitle(title);
      try {
        const savedId = await saveAskAiConversation({
          id: conversationId,
          title,
          chatLog: finalChatLog,
          history: messages,
        });
        if (!conversationId) setConversationId(savedId);
        loadConversations();
      } catch (err) {
        console.warn('Could not save conversation history:', err);
      }
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
    setConversationId(null);
    setConversationTitle('');
    setShowHistory(false);
  };

  const handleOpenConversation = async (id) => {
    setLoadingConversation(true);
    setShowHistory(false);
    try {
      const conv = await getAskAiConversation(id);
      setChatLog(conv.chatLog);
      setHistory(conv.history);
      setConversationId(conv.id);
      setConversationTitle(conv.title);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    } finally {
      setLoadingConversation(false);
    }
  };

  const handleDeleteConversation = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation? This can\'t be undone.')) return;
    try {
      await deleteAskAiConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === conversationId) handleNewConversation();
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      alert('Could not delete this conversation. Please try again.');
    }
  };

  return (
    <div className="ask">
      <div className="ask__header">
        <div>
          <p className="ask__subtitle">Ask about any account, agreement, or contract clause across the organization.</p>
          <p className="ask__disclaimer">By using this tool, you're interacting with our AI system - answers can be wrong, always verify anything important.</p>
        </div>
        <div className="ask__header-actions">
          <div className="ask__history-wrap">
            <button type="button" className="ask__new-btn" onClick={() => setShowHistory((v) => !v)}>
              History{conversations.length > 0 ? ` (${conversations.length})` : ''}
            </button>
            {showHistory && (
              <div className="ask__history-panel">
                {loadingConversations ? (
                  <p className="ask__history-empty">Loading…</p>
                ) : conversations.length === 0 ? (
                  <p className="ask__history-empty">No past conversations yet.</p>
                ) : (
                  conversations.map((c) => (
                    <div
                      key={c.id}
                      className={`ask__history-item ${c.id === conversationId ? 'ask__history-item--active' : ''}`}
                      onClick={() => handleOpenConversation(c.id)}
                    >
                      <div className="ask__history-item-info">
                        <span className="ask__history-item-title">{c.title || 'Untitled'}</span>
                        <span className="ask__history-item-time">{formatRelativeTime(c.updatedAt)}</span>
                      </div>
                      <button
                        type="button"
                        className="ask__history-item-delete"
                        onClick={(e) => handleDeleteConversation(c.id, e)}
                        aria-label="Delete conversation"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          {chatLog.length > 0 && (
            <button type="button" className="ask__new-btn" onClick={handleNewConversation}>
              New conversation
            </button>
          )}
        </div>
      </div>

      <div className="ask__log" ref={scrollRef}>
        {loadingConversation ? (
          <p className="ask__history-empty">Loading conversation…</p>
        ) : chatLog.length === 0 ? (
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
              <div className={`ask__bubble ask__bubble--${msg.role}`}>
                {msg.role === 'assistant' ? (
                  <div className="ask__markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                ) : (
                  msg.text
                )}
              </div>
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

      <div className="ask__quick-prompts">
        {QUICK_PROMPTS.map((qp) => (
          <button
            key={qp.label}
            type="button"
            className="ask__quick-prompt"
            onClick={() => handleSend(qp.prompt)}
            disabled={sending}
          >
            {qp.label}
          </button>
        ))}
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