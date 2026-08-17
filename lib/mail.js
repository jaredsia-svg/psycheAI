// Sends the finished report to the reader as a PDF attachment, over Amazon SES.
//
// This module is deliberately a *relay*. The PDF arrives in the request body,
// is turned into a MIME message, is handed to SES, and goes out of scope. It is
// never written to disk, never put in a database, and never logged — see the
// note on `sendReport` for what that does and does not buy, because the honest
// version of that claim is narrower than it first sounds.
//
// SES rather than Postmark or Resend for one specific reason: SES does not
// retain message content. The other two store full message bodies for their
// dashboards and replay features — 45 days by default on Postmark — which
// would put every reader's personality report in a third party's logs and make
// "we do not keep it" false on day one. That is a vendor choice doing real
// work, not a detail.
'use strict';

const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const REGION = process.env.AWS_REGION || process.env.PSYCHEAI_SES_REGION || 'us-east-1';
const FROM = process.env.PSYCHEAI_MAIL_FROM || '';
const REPLY_TO = process.env.PSYCHEAI_MAIL_REPLY_TO || '';

// Mock mode mirrors PSYCHEAI_MOCK for the model calls: the whole flow runs and
// is testable, and nothing leaves the machine. Without it the suites would
// either need AWS credentials or would have to skip the route entirely.
const MOCK = process.env.PSYCHEAI_MAIL_MOCK === '1' || process.env.PSYCHEAI_MOCK === '1';

let client = null;
function getClient() {
  if (!client) client = new SESv2Client({ region: REGION });
  return client;
}

// Sent in the same process for the tests to read back. Holds the address and
// the byte count, never the attachment — the mock is not a place to start
// keeping what the real path refuses to keep.
const sent = [];

// The covering note. Named rather than inlined so it can be asserted on: it is
// the one place the reader is told who keeps what, and the third party that
// keeps the report permanently is their own mail provider, not this service.
const COVERING_NOTE = [
  'Your PsycheAI report is attached as a PDF.',
  '',
  'It was generated in your browser and relayed to you without being stored:',
  'PsycheAI keeps your email address, and does not keep the report itself.',
  'Your email provider will keep this message, and the attachment, indefinitely.',
  '',
  '— PsycheAI',
].join('\r\n');

class MailError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 502;
  }
}

/**
 * A conservative address check.
 *
 * Deliberately not RFC 5322 — that grammar admits things no mail provider will
 * accept and rejecting a valid oddity here costs a reader their report. This
 * rules out the shapes that are certainly wrong and lets SES be the judge of
 * the rest.
 */
function validAddress(value) {
  const address = String(value || '').trim();
  if (address.length < 6 || address.length > 254) return '';
  if (/\s/.test(address)) return '';
  if (!/^[^@]+@[^@]+\.[A-Za-z]{2,}$/.test(address)) return '';
  return address;
}

function describe() {
  return {
    ready: MOCK || Boolean(FROM),
    mock: MOCK,
    region: REGION,
    from: FROM,
    hint: FROM
      ? ''
      : 'Set PSYCHEAI_MAIL_FROM to a verified SES sender, and give the process AWS credentials.',
  };
}

// A MIME message built by hand rather than with a library: one multipart
// boundary, two parts, and base64 that is already base64 by the time it gets
// here. RFC 2045 caps encoded lines at 76 characters, and some receivers are
// strict about it, so the attachment is re-wrapped rather than sent as one
// enormous line.
function wrap76(base64) {
  return String(base64 || '').replace(/(.{76})/g, '$1\r\n');
}

function buildMime(options) {
  const boundary = 'psycheai-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10);
  const lines = [
    'From: ' + options.from,
    'To: ' + options.to,
  ];
  if (options.replyTo) lines.push('Reply-To: ' + options.replyTo);
  lines.push(
    'Subject: ' + options.subject,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    options.text,
    '',
    '--' + boundary,
    'Content-Type: application/pdf; name="' + options.filename + '"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="' + options.filename + '"',
    '',
    wrap76(options.pdfBase64),
    '',
    '--' + boundary + '--',
    '');
  return lines.join('\r\n');
}

/**
 * Relays one report to one address.
 *
 * What this does not do is as much the point as what it does: the PDF is a
 * local, it is never persisted anywhere by this process, and the address is
 * recorded separately by the caller rather than here, so the two are never
 * written down together.
 *
 * The honest limit on that: an administrator with access to the running server
 * could add logging, attach a debugger, or read process memory. This is
 * "designed so the report is not retained and is not available afterwards",
 * which is a real and useful property — it is not "cryptographically
 * impossible for an operator to see it", which no design with an attachment
 * passing through a server can claim. The other party who certainly does keep
 * a copy is the reader's own mail provider, permanently, and the copy the
 * reader sees says so.
 */
async function sendReport(options) {
  const to = validAddress(options && options.to);
  if (!to) throw new MailError('That does not look like an email address.', 400);

  const pdfBase64 = String((options && options.pdfBase64) || '');
  if (!pdfBase64) throw new MailError('No report was attached to the request.', 400);
  if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(pdfBase64)) {
    throw new MailError('The attached report was not valid base64.', 400);
  }

  const name = String((options && options.name) || 'your').slice(0, 60);
  const filename = 'psycheai-report.pdf';
  const subject = 'Your PsycheAI report';
  const text = COVERING_NOTE;

  if (MOCK) {
    sent.push({ to, bytes: pdfBase64.length, at: new Date().toISOString() });
    return { messageId: 'mock-' + sent.length, mock: true };
  }

  if (!FROM) {
    throw new MailError('This server has no PSYCHEAI_MAIL_FROM configured.', 503);
  }

  const raw = buildMime({
    from: FROM, to, replyTo: REPLY_TO, subject, filename, pdfBase64, text,
  });

  try {
    const result = await getClient().send(new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [to] },
      Content: { Raw: { Data: Buffer.from(raw, 'utf8') } },
    }));
    return { messageId: (result && result.MessageId) || '', mock: false };
  } catch (error) {
    throw asHttpError(error, name);
  }
}

// SES failures a reader can do something about get their own message; the rest
// are reported as a relay problem rather than as a mystery.
function asHttpError(error, name) {
  void name;
  if (error instanceof MailError) return error;
  const message = (error && error.message) || String(error);
  const code = (error && error.name) || '';

  if (/MessageRejected/i.test(code) || /not verified/i.test(message)) {
    return new MailError(
      'The mail service rejected the message. If this server is new, its sending domain or ' +
      'address may still be unverified, or the account may still be in the SES sandbox.', 502);
  }
  if (/AccountSendingPaused|SendingPaused/i.test(code)) {
    return new MailError('Sending is paused on this mail account.', 503);
  }
  if (/Throttl|TooManyRequests|LimitExceeded/i.test(code)) {
    return new MailError('The mail service is rate-limiting this server. Try again shortly.', 429);
  }
  if (/CredentialsProviderError|UnrecognizedClient|InvalidClientTokenId|AccessDenied/i.test(code + message)) {
    return new MailError('This server is not authorised to send mail.', 500);
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message)) {
    return new MailError('Could not reach the mail service.', 503);
  }
  return new MailError('The report could not be sent: ' + message, 502);
}

module.exports = {
  sendReport,
  COVERING_NOTE,
  validAddress,
  describe,
  buildMime,
  __sent: sent,
  MailError,
};
