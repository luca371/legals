import { corsHeaders, jsonResponse, serveWithCors } from '../_shared/cors.ts';
import { requireWriter } from '../_shared/auth.ts';
import { ANTHROPIC_MODEL } from '../_shared/anthropic.ts';
import { monthStartIso, readAgreementDocuments, type Row } from '../_shared/agent-docs.ts';
import { embedTexts } from '../_shared/voyage.ts';
import { enforceAiLimit } from '../_shared/ratelimit.ts';
import { PLAYBOOK_COLUMNS, actionAllowed, playbookForAgent } from '../_shared/playbooks.ts';

// Draft Studio agent. The user chats, the agent writes the agreement. The
// answer is STREAMED as plain text so the browser can type the document onto
// the page while it is being written. The model marks the parts of its output
// with tags the browser splits on:
//   free text            -> the chat bubble
//   <document>...</document> -> the HTML of the agreement (the paper)
//   <meta>{...}</meta>   -> title, type, parties and dates for "Create agreement"
//   <error>...</error>   -> added by this function if something fails mid-stream
// It never saves anything - the user creates the agreement from the page.

const MAX_TOKENS = 8000;
const MAX_RUNS_PER_TENANT_PER_MONTH = 300;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;
const MAX_CURRENT_HTML_CHARS = 60000;
const MAX_BLOCKS = 400;
const MAX_BLOCK_CHARS = 8000;
const MAX_ACCOUNTS_IN_LIST = 300;
const MAX_MATCHED_ACCOUNTS = 6;
const MAX_CLAUSE_CHARS_TOTAL = 8000;
const MAX_PRECEDENTS = 3;
const PRECEDENT_CHARS = 3500;
const MIN_PRECEDENT_SIMILARITY = 0.3;

const LANGUAGES = ['English', 'Romanian', 'French', 'German', 'Spanish'];

const SYSTEM_PROMPT = `You are the drafting agent in "EsoVia", a contract lifecycle management platform. The user chats with you on the right of their screen; on the left there is a blank sheet of paper where YOU write the agreement while they watch.

HOW TO ANSWER - follow this layout exactly:
1. First, a short chat message (1-2 sentences) saying what you are about to draft and any assumption you made. Plain text, no markdown.
2. Then the agreement itself between the tags <document> and </document>.
3. Then a short chat message (1-3 sentences): what you filled in from the user's accounts, which details are still placeholders, and anything worth knowing (an existing agreement with the same party, a playbook rule you applied, which precedent agreement you followed - name it by its title). Plain text, no markdown, no legal-advice disclaimer.
4. Last, a JSON object between <meta> and </meta> (described below).

If the request is too unclear to draft (for example the kind of agreement is not known), ask ONE short question in plain text and write NO <document> and NO <meta>. Otherwise prefer drafting with placeholders over asking questions.

EDITING AN EXISTING DOCUMENT: when a CURRENT DOCUMENT is provided it is split into numbered blocks, like [#12] <p>...</p>. When the user asks for a change, do NOT rewrite the document. Change only the blocks that must change, using edit tags, in document order:
- <edit op="replace" id="12">new HTML for that block - one block or several</edit>
- <edit op="insert_after" id="12">new block(s) to add after block 12</edit>   (id="0" adds at the very beginning)
- <edit op="delete" id="12"></edit>
Never repeat blocks that stay the same. If the change affects other places (clause numbers, cross-references, a defined term used elsewhere, the signature block), edit those blocks too. Block numbers refer to the document exactly as you were given it - do not renumber them. The HTML inside an edit follows the same rules as the document HTML below.
Layout of an edit answer: 1) one short chat sentence saying what you are about to change; 2) the <edit> tags; 3) one short chat sentence saying what you changed and where (name the clause); 4) a <meta> JSON ONLY if one of its fields changed (title, parties, language, dates), containing only the changed fields. Only if the user asks to rewrite the whole thing (another language, a completely different agreement) output a complete <document> as for a first draft.

THE DOCUMENT (inside <document>):
- Write clean HTML using ONLY these tags: h1, h2, h3, p, ol, ul, li, strong, em, u, br, table, thead, tbody, tr, td, th, blockquote. No attributes, no styles, no classes, no markdown, no code fences.
- Structure: <h1> with the title; an opening paragraph with the date and the parties (full legal name, registered office and tax registration number when the account data has them); background/recitals if useful; numbered clauses as <h2>1. Clause title</h2> followed by <p> paragraphs numbered 1.1, 1.2 ...; and at the end a signature block as a two-column <table> (one column per party: name, signatory, title, date, signature line).
- Use the real data of the parties from the ACCOUNT DETAILS you are given. NEVER invent names, addresses, registration numbers, amounts or dates. Anything you do not know becomes a visible placeholder such as [__________] or [Effective Date].
- Use approved clauses from the CLAUSE LIBRARY when they fit the agreement, adapting names and numbering but keeping their wording. Apply the rules of the PLAYBOOKS of the parties.
- PRECEDENTS: you may be given SIMILAR AGREEMENTS this organization already has. Learn from them how THIS organization writes this kind of agreement: structure and numbering, defined terms, the positions it usually takes (term, notice period, governing law, liability, confidentiality survival). Never copy anything that belongs to another counterparty: no party names, addresses, registration numbers, amounts, dates, personal data or deal-specific terms. Only reuse generic wording. The user's request, the playbooks and the approved clauses always win over a precedent. Ignore a precedent that is not really similar.
- Write balanced, standard terms appropriate to the agreement type. Unless the user asks for another language, write the document in the language of the user's request; if they name a contract language, use that one.
- Be complete but not padded: a standard NDA is about 1-2 pages, a services agreement 3-6 pages.

THE META JSON (inside <meta>), exactly these fields:
{"title": "<short agreement title, e.g. 'Mutual NDA - Acme / Beta'>", "agreementType": "<one of the allowed types, or null>", "agreementSubtype": "<one of the allowed subtypes for that type, or null>", "language": "<one of the allowed languages>", "accountId": "<id of the first named party if it is in the ACCOUNTS list, else null>", "account2Id": "<id of the second named party if it is in the ACCOUNTS list, else null>", "effectiveDate": "<YYYY-MM-DD if the user gave one, else null>", "endDate": "<YYYY-MM-DD if the user gave one or it follows from a stated duration, else null>"}
Use account ids only from the ACCOUNTS list - never invent one. Dates only if stated.

You are NOT providing legal advice: write sensible standard drafting that a lawyer would review.`;

// deno-lint-ignore no-explicit-any
function cap(value: any, max: number) {
  return String(value ?? '').slice(0, max);
}

// The organization's own agreements most like what the user asked for, read
// through the user's access (RLS), so only what they could open themselves.
// Executed or generated agreements come before drafts. Any failure just means
// "no precedents" - the draft is still written.
// deno-lint-ignore no-explicit-any
async function findPrecedents(callerClient: any, queryText: string) {
  try {
    const [embedding] = await embedTexts(Deno.env.get('VOYAGE_API_KEY') ?? '', [queryText], 'query');
    const { data: matches, error } = await callerClient.rpc('match_objects', {
      query_embedding: embedding,
      filter_type: 'agreement',
      match_count: 6,
    });
    if (error || !matches?.length) return [];

    const relevant: Row[] = (matches as Row[]).filter((m) => m.similarity >= MIN_PRECEDENT_SIMILARITY);
    if (relevant.length === 0) return [];

    const { data: rows } = await callerClient
      .from('agreements')
      .select('id, title, agreement_type, agreement_subtype, language, status, account_name, account2_name, content_html, attachments')
      .in('id', relevant.map((m) => m.object_id));
    const byId = new Map((rows || []).map((r: Row) => [r.id, r]));
    const ordered = relevant.map((m) => byId.get(m.object_id)).filter(Boolean) as Row[];
    const preferred = [...ordered.filter((r) => r.status !== 'Draft'), ...ordered.filter((r) => r.status === 'Draft')].slice(
      0,
      MAX_PRECEDENTS
    );

    const precedents = [];
    for (const r of preferred) {
      const { documents } = await readAgreementDocuments(r, PRECEDENT_CHARS, false);
      const text = documents.map((d) => d.text).join('\n').slice(0, PRECEDENT_CHARS);
      if (!text.trim()) continue;
      precedents.push({
        id: r.id as string,
        title: r.title as string,
        type: r.agreement_type as string,
        subtype: r.agreement_subtype as string,
        language: r.language as string,
        status: r.status as string,
        parties: [r.account_name, r.account2_name].filter(Boolean),
        text,
      });
    }
    return precedents;
  } catch (err) {
    console.error('Precedent search failed (drafting without precedents):', err);
    return [];
  }
}

serveWithCors(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireWriter(req);
  if ('error' in auth) return jsonResponse({ error: auth.error }, auth.status);
  const limited = await enforceAiLimit(auth, 'agent-draft');
  if (limited) return limited;
  const { admin, callerClient, user, tenantId } = auth;

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400);
  }

  // -- messages ---------------------------------------------------------------
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
  // deno-lint-ignore no-explicit-any
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of rawMessages) {
    const role = m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : null;
    const content = cap(m?.content, MAX_MESSAGE_CHARS).trim();
    if (!role || !content) continue;
    if (messages.length === 0 && role !== 'user') continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else messages.push({ role, content });
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return jsonResponse({ error: 'messages must end with a user message.' }, 400);
  }
  // The document on the page, as its top-level blocks (HTML strings). The agent
  // refers to them by number and answers with edits, not a rewrite.
  const blocks: string[] = [];
  let blockChars = 0;
  if (Array.isArray(body.blocks)) {
    for (const b of body.blocks.slice(0, MAX_BLOCKS)) {
      const html = cap(b, MAX_BLOCK_CHARS);
      if (!html.trim()) continue;
      blockChars += html.length;
      if (blockChars > MAX_CURRENT_HTML_CHARS) break;
      blocks.push(html);
    }
  }

  try {
    const { count: runsThisMonth } = await admin
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', monthStartIso());
    if ((runsThisMonth ?? 0) >= MAX_RUNS_PER_TENANT_PER_MONTH) {
      return jsonResponse({ error: 'Your organization reached its monthly limit of agent runs.' }, 429);
    }

    // -- context the agent may use (all read through the user's own access) ---
    const { data: accounts } = await callerClient
      .from('accounts')
      .select('id, name, country, city, address, tax_registration_number, abbreviation, registered_office, status')
      .limit(500);
    const accountRows: Row[] = accounts || [];

    const conversationText = messages.map((m) => m.content).join(' ').toLowerCase();
    const matched = accountRows
      .filter((a) => a.name && String(a.name).trim().length >= 2 && conversationText.includes(String(a.name).toLowerCase()))
      .slice(0, MAX_MATCHED_ACCOUNTS);
    const matchedIds = matched.map((a) => a.id);

    let playbooks: Row[] = [];
    let existingAgreements: Row[] = [];
    if (matchedIds.length > 0) {
      const [pb, ag] = await Promise.all([
        callerClient.from('account_playbooks').select(`account_id, playbooks(${PLAYBOOK_COLUMNS})`).in('account_id', matchedIds),
        callerClient
          .from('agreements')
          .select('account_id, title, agreement_type, agreement_subtype, status, end_date')
          .in('account_id', matchedIds)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);
      playbooks = pb.data || [];
      existingAgreements = ag.data || [];
    }

    const { data: clauses } = await callerClient
      .from('clause_library')
      .select('title, category, body, language')
      .limit(60);
    let clauseBudget = MAX_CLAUSE_CHARS_TOTAL;
    const clauseList: Row[] = [];
    for (const c of clauses || []) {
      const text = cap(c.body, 700);
      if (clauseBudget - text.length < 0) break;
      clauseBudget -= text.length;
      clauseList.push({ title: c.title, category: c.category || '', language: c.language || 'English', text });
    }

    // Precedents only for a first draft: a revision already has the document in hand.
    const userTurns = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const precedentQuery = [...new Set([userTurns[0], userTurns[userTurns.length - 1]])].join('\n').slice(0, 700);
    const precedents = blocks.length > 0 ? [] : await findPrecedents(callerClient, precedentQuery);

    const { data: schema } = await callerClient
      .from('object_schemas')
      .select('built_in_configs')
      .eq('object_type', 'agreement')
      .maybeSingle();
    const configs = schema?.built_in_configs || {};

    const today = new Date().toISOString().slice(0, 10);
    const context = `

TODAY'S DATE: ${today}

ACCOUNTS (every account of this organization - the only ids you may use in the meta):
${JSON.stringify(accountRows.slice(0, MAX_ACCOUNTS_IN_LIST).map((a) => ({ id: a.id, name: a.name })))}

ACCOUNT DETAILS (the accounts named in the conversation - use these facts in the document):
${JSON.stringify(
  matched.map((a) => ({
    id: a.id,
    name: a.name,
    country: a.country,
    city: a.city,
    address: a.address,
    registeredOffice: a.registered_office,
    taxRegistrationNumber: a.tax_registration_number,
    abbreviation: a.abbreviation,
  }))
)}

PLAYBOOKS of those accounts (rules the document must respect; obligations it must contain):
${JSON.stringify(playbooks.map((p) => ({ accountId: p.account_id, ...playbookForAgent(p.playbooks) })))}
${(() => {
  const blocked = matched.filter((a) => !actionAllowed(playbooks.filter((p) => p.account_id === a.id).map((p) => p.playbooks), 'draft'));
  return blocked.length
    ? `\nDRAFTING NOT PERMITTED for these accounts by their playbook: ${JSON.stringify(blocked.map((a) => a.name))}. If the user asks for an agreement with one of them, do not write a document: say in the chat that the account's playbook does not allow AI drafting.\n`
    : '';
})()}
EXISTING AGREEMENTS with those accounts:
${JSON.stringify(existingAgreements)}

CLAUSE LIBRARY (approved clauses):
${JSON.stringify(clauseList)}

SIMILAR AGREEMENTS already in this organization (precedents - how it writes this kind of agreement; never copy their party-specific details):
${JSON.stringify(precedents.map((p) => ({ title: p.title, type: p.type, subtype: p.subtype, language: p.language, status: p.status, text: p.text })))}

ALLOWED agreement types: ${JSON.stringify(configs.agreementType || [])}
ALLOWED agreement subtypes by type: ${JSON.stringify(configs.agreementTypeSubtypeMap || {})}
ALLOWED subtypes (all): ${JSON.stringify(configs.agreementSubtype || [])}
ALLOWED languages: ${JSON.stringify(LANGUAGES)}`;

    // The document currently on the page rides along with the last user turn,
    // as numbered blocks the agent can point at.
    if (blocks.length > 0) {
      const numbered = blocks.map((html, i) => `[#${i + 1}] ${html}`).join('\n');
      messages[messages.length - 1].content += `\n\n[CURRENT DOCUMENT ON THE PAGE - ${blocks.length} numbered blocks. If the user asks for a change, answer with <edit> tags for only the blocks that change.]\n${numbered}`;
    }

    const { data: run } = await admin
      .from('agent_runs')
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        actor_email: user.email ?? '',
        agent: 'draft',
        subject_type: 'draft',
        subject_id: 'new',
      })
      .select('id')
      .single();
    const runId: string | null = run?.id ?? null;

    // -- stream ---------------------------------------------------------------
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let inputTokens = 0;
        let outputTokens = 0;
        let failed: string | null = null;
        const send = (text: string) => controller.enqueue(encoder.encode(text));

        // Tell the page which agreements the agent looked at, before it starts
        // writing. "<" is escaped so a title can never look like a tag.
        if (precedents.length > 0) {
          send(
            `<sources>${JSON.stringify(precedents.map((p) => ({ id: p.id, title: p.title, status: p.status }))).replace(/</g, '\\u003c')}</sources>`
          );
        }

        try {
          const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
          if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY secret on the Edge Function.');

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: ANTHROPIC_MODEL,
              max_tokens: MAX_TOKENS,
              stream: true,
              system: SYSTEM_PROMPT + context,
              messages,
            }),
          });
          if (!response.ok || !response.body) {
            const text = await response.text().catch(() => '');
            throw new Error(`Anthropic API error (${response.status}): ${text.slice(0, 300)}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let stopReason = '';

          const handleEvent = (raw: string) => {
            const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) return;
            let event: Row;
            try {
              event = JSON.parse(dataLine.slice(5).trim());
            } catch {
              return;
            }
            if (event.type === 'message_start') inputTokens = event.message?.usage?.input_tokens ?? 0;
            else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') send(event.delta.text);
            else if (event.type === 'message_delta') {
              outputTokens = event.usage?.output_tokens ?? outputTokens;
              stopReason = event.delta?.stop_reason ?? stopReason;
            } else if (event.type === 'error') throw new Error(event.error?.message || 'The AI service returned an error.');
          };

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let sep = buffer.indexOf('\n\n');
            while (sep !== -1) {
              handleEvent(buffer.slice(0, sep));
              buffer = buffer.slice(sep + 2);
              sep = buffer.indexOf('\n\n');
            }
          }
          if (buffer.trim()) handleEvent(buffer);

          if (stopReason === 'max_tokens') {
            send('\n<error>The document was too long and got cut off. Ask for a shorter version.</error>');
          }
        } catch (err) {
          console.error('Draft agent error:', err);
          failed = err instanceof Error ? err.message : 'Drafting failed.';
          send('\n<error>Drafting failed. Please try again.</error>');
        } finally {
          try {
            if (runId) {
              await admin
                .from('agent_runs')
                .update({
                  status: failed ? 'failed' : 'done',
                  steps: 1,
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                  error: failed ? failed.slice(0, 500) : null,
                  finished_at: new Date().toISOString(),
                })
                .eq('id', runId);
            }
            if (!failed) {
              await admin.from('audit_log').insert({
                tenant_id: tenantId,
                actor_email: user.email ?? '',
                action: 'agent_run',
                object_type: 'draft',
                object_id: null,
                object_label: '',
                details: { agent: 'draft', runId },
              });
            }
          } catch (logErr) {
            console.error('Could not record the draft run:', logErr);
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('Draft agent setup error:', err);
    return jsonResponse({ error: 'Drafting failed.' }, 500);
  }
});
