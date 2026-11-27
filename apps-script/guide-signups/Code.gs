/**
 * Threshold guide signups: the Stretch Smarter (BAAD) guide signup log and mail queue for thresholdhp.com.
 *
 * Bound to the "Threshold guide signups" Sheet, owned by dr.lars@thresholdhp.com. The copy in the website repo
 * (apps-script/guide-signups/Code.gs) is the source; after a change, paste it here (README.md says how).
 *
 * The website renders every email (the copy lives in its lib/email/sequence.ts) and posts each signup here from
 * its server (app/api/guide). This script:
 *  - logs the signup on the Signups tab, one row per email address (Life HQ's Leads tab reads it, read-only),
 *  - sends the guide right away through Gmail from this account, PDF attached, so every email shows in Sent,
 *  - queues day 2 and day 5 on the Outbox tab, which sendDue() (every 5 minutes) sends when they're due,
 *  - marks unsubscribes the site passes on (app/api/unsubscribe) and cancels the follow-ups still queued.
 *
 * Setup, once: run setup() and approve Google's permissions, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone), then run showSiteKey() and paste the key into Vercel (GUIDE_SCRIPT_KEY).
 */

const VERSION = '2026-11-27';
const TZ = 'America/New_York';
const FROM_NAME = 'Dr. Lars Stevenson';
const FROM_EMAIL = 'dr.lars@thresholdhp.com';
const SIGNUPS = 'Signups';
const OUTBOX = 'Outbox';
// Life HQ reads the Signups columns by these names. Rename one and Life HQ's sync stops with an error.
const SIGNUP_HEADERS = ['ID', 'Signed up', 'First name', 'Email', 'Page', 'Form', 'Status', 'Guide sent', 'Day 2 due',
  'Day 2 sent', 'Day 5 due', 'Day 5 sent', 'Unsubscribed', 'Signups', 'Last signup', 'Test', 'Problem'];
const OUTBOX_HEADERS = ['Created', 'Email', 'Step', 'Due', 'Status', 'Tries', 'Sent', 'Gmail ID', 'Error', 'Subject',
  'Text', 'HTML', 'Unsubscribe URL', 'Attach URL', 'Attach name'];
const STEPS = ['thanks', 'd2', 'd5'];
const SENT_COLUMN = { thanks: 'Guide sent', d2: 'Day 2 sent', d5: 'Day 5 sent' };
const DUE_COLUMN = { d2: 'Day 2 due', d5: 'Day 5 due' };
const STEP_LABEL = { thanks: 'Guide', d2: 'Day 2', d5: 'Day 5' };
const FORMS = ['inline', 'popup', 'button'];
const MAX_TRIES = 3;
const LATE_LIMIT_MS = 2 * 24 * 3600 * 1000; // a follow-up more than 2 days late is dropped, not sent
const BATCH = 20; // the most emails one sendDue() run sends
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ATTACH_HOSTS = ['https://www.thresholdhp.com/', 'https://thresholdhp.com/'];
const PDF_PATH = 'guides/stretch-smarter-k7q2m9.pdf';

// ---------------------------------------------------------------- web app

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return reply_({ ok: false, error: 'bad request' });
  }
  if (!body || typeof body !== 'object' || !keyOk_(body.key)) return reply_({ ok: false, error: 'forbidden' });
  try {
    if (body.action === 'signup') return reply_(signup_(body));
    if (body.action === 'unsubscribe') return reply_(unsubscribe_(body));
    if (body.action === 'ping') return reply_({ ok: true, version: VERSION });
    return reply_({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error(err);
    return reply_({ ok: false, error: errText_(err) });
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function keyOk_(given) {
  const want = PropertiesService.getScriptProperties().getProperty('SITE_KEY');
  if (!want || typeof given !== 'string' || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- signup

/**
 * - new address: guide now, day 2 and day 5 queued.
 * - already signed up: the guide again, no second round of follow-ups.
 * - unsubscribed before: the guide only (they asked for it); they stay unsubscribed.
 * - the guide already went out today: nothing new (a double click or a refresh).
 */
function signup_(body) {
  const lead = body.lead || {};
  const email = String(lead.email || '').trim().toLowerCase();
  const firstName = oneLine_(lead.firstName, 100);
  if (!EMAIL_RE.test(email) || email.length > 200) return { ok: false, error: 'bad email' };
  if (!firstName) return { ok: false, error: 'no first name' };
  const info = body.signup || {};
  const page = oneLine_(info.page, 200);
  const form = FORMS.indexOf(info.form) >= 0 ? info.form : 'inline';
  const emails = cleanEmails_(body.emails);
  if (!emails.thanks) return { ok: false, error: 'no guide email' };
  const test = email.indexOf('+baadtest') >= 0;

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const book = book_();
    const now = new Date();
    const found = findLead_(book.signups, email);
    const contact = !found ? 'new' : cell_(book.signups, found, 'Status') === 'Unsubscribed' ? 'previously-unsubscribed' : 'existing';
    const repeatToday = Boolean(found) && cell_(book.signups, found, 'Guide sent').slice(0, 10) === day_(now);
    const steps = repeatToday ? [] : contact === 'new' ? STEPS.filter(function (s) { return emails[s]; }) : ['thanks'];

    let leadRow;
    if (!found) {
      const fields = {
        'ID': leadId_(email), 'Signed up': stamp_(now), 'First name': firstName, 'Email': email, 'Page': page,
        'Form': form, 'Status': 'Subscribed', 'Signups': 1, 'Last signup': stamp_(now), 'Test': test ? 'TRUE' : 'FALSE',
      };
      Object.keys(DUE_COLUMN).forEach(function (s) { if (emails[s]) fields[DUE_COLUMN[s]] = stamp_(emails[s].due); });
      leadRow = appendRow_(book.signups, fields);
    } else {
      leadRow = found.row;
      const fields = { 'Signups': Number(cell_(book.signups, found, 'Signups') || 0) + 1, 'Last signup': stamp_(now) };
      if (!cell_(book.signups, found, 'First name')) fields['First name'] = firstName;
      patch_(book.signups, leadRow, fields);
    }

    let guide = { sent: false, skipped: repeatToday ? 'already sent today' : '' };
    const queued = [];
    steps.forEach(function (step) {
      const m = emails[step];
      const due = step === 'thanks' ? now : m.due;
      const job = {
        email: email, step: step, subject: m.subject, text: m.text, html: m.html, unsubscribeUrl: m.unsubscribeUrl,
        attachUrl: m.attach ? m.attach.url : '', attachName: m.attach ? m.attach.name : '', tries: 0, leadRow: leadRow,
      };
      job.row = appendRow_(book.outbox, {
        'Created': stamp_(now), 'Email': email, 'Step': step, 'Due': stamp_(due), 'Status': 'queued', 'Tries': 0,
        'Subject': job.subject, 'Text': job.text, 'HTML': job.html, 'Unsubscribe URL': job.unsubscribeUrl,
        'Attach URL': job.attachUrl, 'Attach name': job.attachName,
      });
      if (step === 'thanks') guide = sendJob_(book, job);
      else queued.push({ step: step, due: due.toISOString() });
    });
    setNextDue_();
    return { ok: true, version: VERSION, contact: contact, repeat: repeatToday, test: test, guide: guide, queued: queued };
  } finally {
    lock.releaseLock();
  }
}

/** The emails the site rendered, checked before anything is stored or sent. */
function cleanEmails_(list) {
  if (!Array.isArray(list)) throw new Error('emails must be a list');
  const out = {};
  list.forEach(function (m) {
    if (!m || STEPS.indexOf(m.step) < 0) throw new Error('unknown email step');
    const subject = oneLine_(m.subject, 200);
    const text = String(m.text || '');
    const html = String(m.html || '');
    if (!subject || !text || !html) throw new Error(m.step + ': subject, text and html are required');
    if (text.length > 20000 || html.length > 40000) throw new Error(m.step + ': email too long');
    const unsubscribeUrl = String(m.unsubscribeUrl || '');
    if (!/^https:\/\/[^\s<>"]+$/.test(unsubscribeUrl)) throw new Error(m.step + ': bad unsubscribe link');
    let due = null;
    if (m.step !== 'thanks') {
      due = new Date(m.due);
      const ahead = due.getTime() - Date.now();
      if (isNaN(ahead) || ahead < -60000 || ahead > 30 * 24 * 3600 * 1000) throw new Error(m.step + ': bad send time');
    }
    let attach = null;
    if (m.attach) {
      const url = String(m.attach.url || '');
      const name = String(m.attach.name || '');
      if (!ATTACH_HOSTS.some(function (h) { return url.indexOf(h) === 0; })) throw new Error(m.step + ': the attachment must come from thresholdhp.com');
      if (!/^[A-Za-z0-9._-]{1,80}\.pdf$/.test(name)) throw new Error(m.step + ': bad attachment name');
      attach = { url: url, name: name };
    }
    out[m.step] = { subject: subject, text: text, html: html, unsubscribeUrl: unsubscribeUrl, due: due, attach: attach };
  });
  return out;
}

// ---------------------------------------------------------------- unsubscribe

/** Marks the address unsubscribed (adding a row if it isn't on the list) and cancels its queued follow-ups. */
function unsubscribe_(body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) return { ok: false, error: 'bad email' };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const book = book_();
    const now = stamp_(new Date());
    const lead = findLead_(book.signups, email);
    const already = Boolean(lead) && cell_(book.signups, lead, 'Status') === 'Unsubscribed';
    if (!lead) {
      appendRow_(book.signups, {
        'ID': leadId_(email), 'Signed up': now, 'Email': email, 'Form': 'unsubscribe', 'Status': 'Unsubscribed',
        'Unsubscribed': now, 'Signups': 0, 'Test': email.indexOf('+baadtest') >= 0 ? 'TRUE' : 'FALSE',
      });
    } else if (!already) {
      patch_(book.signups, lead.row, { 'Status': 'Unsubscribed', 'Unsubscribed': now });
    }
    const o = book.outbox;
    let canceled = 0;
    o.rows.forEach(function (r, i) {
      if (String(r[o.col['Email']]).trim().toLowerCase() !== email) return;
      if (String(r[o.col['Status']]) !== 'queued' || String(r[o.col['Step']]) === 'thanks') return;
      patch_(o, i + 2, { 'Status': 'canceled', 'Error': 'unsubscribed', 'Text': '', 'HTML': '' });
      canceled++;
    });
    setNextDue_();
    return { ok: true, found: Boolean(lead), already: already, canceled: canceled };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- the timer

/** Every 5 minutes: sends the queued emails that are due (and retries failed ones, up to 3 tries in all). */
function sendDue() {
  const props = PropertiesService.getScriptProperties();
  const next = Number(props.getProperty('NEXT_DUE') || 0);
  if (next && Date.now() < next) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const book = book_();
    const o = book.outbox;
    const now = new Date();
    let sent = 0;
    o.rows.forEach(function (r, i) {
      if (sent >= BATCH || String(r[o.col['Status']]) !== 'queued') return;
      const due = parseStamp_(text_(r[o.col['Due']]));
      if (!due || due.getTime() > now.getTime()) return;
      const rowNumber = i + 2;
      const email = String(r[o.col['Email']]).trim().toLowerCase();
      const step = String(r[o.col['Step']]);
      const lead = findLead_(book.signups, email);
      if (step !== 'thanks' && lead && cell_(book.signups, lead, 'Status') === 'Unsubscribed') {
        patch_(o, rowNumber, { 'Status': 'canceled', 'Error': 'unsubscribed', 'Text': '', 'HTML': '' });
        return;
      }
      if (step !== 'thanks' && now.getTime() - due.getTime() > LATE_LIMIT_MS) {
        patch_(o, rowNumber, { 'Status': 'canceled', 'Error': 'more than 2 days late, not sent', 'Text': '', 'HTML': '' });
        if (lead) patch_(book.signups, lead.row, { 'Problem': STEP_LABEL[step] + ' email was more than 2 days late, so it was not sent' });
        return;
      }
      sendJob_(book, {
        row: rowNumber, leadRow: lead ? lead.row : 0, email: email, step: step,
        subject: String(r[o.col['Subject']]), text: String(r[o.col['Text']]), html: String(r[o.col['HTML']]),
        unsubscribeUrl: String(r[o.col['Unsubscribe URL']]), attachUrl: String(r[o.col['Attach URL']]),
        attachName: String(r[o.col['Attach name']]), tries: Number(r[o.col['Tries']] || 0),
      });
      sent++;
    });
    setNextDue_();
  } finally {
    lock.releaseLock();
  }
}

/** Sends one queued email and records the result on both tabs. Never throws. */
function sendJob_(book, job) {
  const o = book.outbox;
  const tries = job.tries + 1;
  try {
    const id = sendMail_(job);
    const sentAt = stamp_(new Date());
    patch_(o, job.row, { 'Status': 'sent', 'Tries': tries, 'Sent': sentAt, 'Gmail ID': id, 'Error': '', 'Text': '', 'HTML': '' });
    if (job.leadRow) {
      const fields = {};
      fields[SENT_COLUMN[job.step]] = sentAt;
      const problem = String(book.signups.sheet.getRange(job.leadRow, book.signups.col['Problem'] + 1).getValue() || '');
      if (problem.indexOf(STEP_LABEL[job.step] + ' email') === 0) fields['Problem'] = '';
      patch_(book.signups, job.leadRow, fields);
    }
    console.log('sent ' + job.step + ' (' + id + ')');
    return { sent: true, id: id };
  } catch (err) {
    const error = errText_(err);
    const fields = { 'Tries': tries, 'Error': error };
    if (tries >= MAX_TRIES) {
      fields['Status'] = 'failed';
      if (job.leadRow) patch_(book.signups, job.leadRow, { 'Problem': STEP_LABEL[job.step] + ' email failed ' + tries + ' times: ' + error });
    }
    patch_(o, job.row, fields);
    console.error('send failed: ' + job.step + ': ' + error);
    return { sent: false, error: error, retry: tries < MAX_TRIES };
  }
}

/** When sendDue() next has work: the earliest queued email, and never more than an hour away (a safety net). */
function setNextDue_() {
  const o = table_(SpreadsheetApp.getActive().getSheetByName(OUTBOX), OUTBOX_HEADERS);
  let min = Date.now() + 3600 * 1000;
  o.rows.forEach(function (r) {
    if (String(r[o.col['Status']]) !== 'queued') return;
    const d = parseStamp_(text_(r[o.col['Due']]));
    if (d && d.getTime() < min) min = d.getTime();
  });
  PropertiesService.getScriptProperties().setProperty('NEXT_DUE', String(min));
}

// ---------------------------------------------------------------- Gmail

/**
 * Sends through the Gmail API (send-only permission), so the email shows in this account's Sent folder and can carry
 * the one-click unsubscribe headers that GmailApp and MailApp can't set.
 */
function sendMail_(job) {
  if (!EMAIL_RE.test(job.email)) throw new Error('bad address');
  const alt = 'alt_' + Utilities.getUuid().replace(/-/g, '');
  const head = [
    'From: "' + FROM_NAME + '" <' + FROM_EMAIL + '>',
    'To: ' + job.email,
    'Subject: ' + header_(job.subject),
    'MIME-Version: 1.0',
  ];
  if (/^https:\/\/[^\s<>"]+$/.test(job.unsubscribeUrl)) {
    head.push('List-Unsubscribe: <' + job.unsubscribeUrl + '>');
    head.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }
  const bodies = [
    '--' + alt, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64_(job.text),
    '--' + alt, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64_(job.html),
    '--' + alt + '--',
  ];
  let lines;
  if (job.attachUrl) {
    const mixed = 'mixed_' + Utilities.getUuid().replace(/-/g, '');
    const name = /^[A-Za-z0-9._-]{1,80}\.pdf$/.test(job.attachName) ? job.attachName : 'guide.pdf';
    lines = head.concat(
      ['Content-Type: multipart/mixed; boundary="' + mixed + '"', '', '--' + mixed,
        'Content-Type: multipart/alternative; boundary="' + alt + '"', ''],
      bodies,
      ['', '--' + mixed, 'Content-Type: application/pdf; name="' + name + '"',
        'Content-Disposition: attachment; filename="' + name + '"', 'Content-Transfer-Encoding: base64', '',
        wrap_(Utilities.base64Encode(attachment_(job.attachUrl))), '--' + mixed + '--', ''],
    );
  } else {
    lines = head.concat(['Content-Type: multipart/alternative; boundary="' + alt + '"', ''], bodies, ['']);
  }
  const sent = Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(lines.join('\r\n')) }, 'me');
  if (!sent || !sent.id) throw new Error('Gmail returned no message id');
  return sent.id;
}

const pdfCache_ = {};
/** The guide PDF from the live site, fetched once per run. */
function attachment_(url) {
  if (!ATTACH_HOSTS.some(function (h) { return url.indexOf(h) === 0; })) throw new Error('attachment must come from thresholdhp.com');
  if (!pdfCache_[url]) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const type = String(res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');
    if (res.getResponseCode() !== 200) throw new Error('PDF download failed (' + res.getResponseCode() + ')');
    if (type.indexOf('pdf') < 0) throw new Error('PDF download returned ' + (type || 'no content type'));
    const bytes = res.getContent();
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('PDF download was ' + bytes.length + ' bytes');
    pdfCache_[url] = bytes;
  }
  return pdfCache_[url];
}

function header_(s) {
  const v = String(s).replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(v) ? v : '=?UTF-8?B?' + Utilities.base64Encode(v, Utilities.Charset.UTF_8) + '?=';
}

function b64_(s) {
  return wrap_(Utilities.base64Encode(String(s), Utilities.Charset.UTF_8));
}

function wrap_(s) {
  return (s.match(/.{1,76}/g) || ['']).join('\r\n');
}

// ---------------------------------------------------------------- the Sheet

function book_() {
  const ss = SpreadsheetApp.getActive();
  const signups = ss.getSheetByName(SIGNUPS);
  const outbox = ss.getSheetByName(OUTBOX);
  if (!signups || !outbox) throw new Error('The Signups or Outbox tab is missing: run setup()');
  return { signups: table_(signups, SIGNUP_HEADERS), outbox: table_(outbox, OUTBOX_HEADERS) };
}

/** A tab's rows plus a column lookup by header name, so a column Lars adds or moves breaks nothing. */
function table_(sheet, required) {
  const values = sheet.getDataRange().getValues();
  const head = (values[0] || []).map(String);
  const col = {};
  required.forEach(function (name) {
    const i = head.indexOf(name);
    if (i < 0) throw new Error('The ' + sheet.getName() + ' tab has no "' + name + '" column');
    col[name] = i;
  });
  return { sheet: sheet, head: head, col: col, rows: values.slice(1) };
}

function findLead_(t, email) {
  const c = t.col['Email'];
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][c]).trim().toLowerCase() === email) return { row: i + 2, values: t.rows[i] };
  }
  return null;
}

function cell_(t, found, name) {
  return text_(found.values[t.col[name]]).trim();
}

/** Adds a row as plain text (so Sheets never turns a time into a date value), filling columns by name. */
function appendRow_(t, fields) {
  const row = t.head.map(function (h) { return Object.prototype.hasOwnProperty.call(fields, h) ? fields[h] : ''; });
  const n = t.sheet.getLastRow() + 1;
  const range = t.sheet.getRange(n, 1, 1, row.length);
  range.setNumberFormat('@');
  range.setValues([row]);
  return n;
}

/** Writes only the named cells of one row, so a formula Lars keeps in his own column is never overwritten. */
function patch_(t, rowNumber, fields) {
  Object.keys(fields).forEach(function (name) {
    const i = t.head.indexOf(name);
    if (i < 0) throw new Error('No "' + name + '" column on ' + t.sheet.getName());
    t.sheet.getRange(rowNumber, i + 1).setValue(fields[name]);
  });
}

// ---------------------------------------------------------------- small helpers

/** "g-" plus the first 16 hex characters of the address's SHA-256 (Life HQ works it out the same way). */
function leadId_(email) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email, Utilities.Charset.UTF_8);
  return 'g-' + bytes.slice(0, 8).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function stamp_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm');
}

function day_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function parseStamp_(s) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(s))) return null;
  try {
    return Utilities.parseDate(String(s), TZ, 'yyyy-MM-dd HH:mm');
  } catch (err) {
    return null;
  }
}

/** A cell's value as text; a date Lars typed in reads as "yyyy-MM-dd HH:mm" in Eastern time. */
function text_(v) {
  return v instanceof Date ? stamp_(v) : String(v === null || v === undefined ? '' : v);
}

function oneLine_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function errText_(err) {
  return String((err && err.message) || err).slice(0, 300);
}

// ---------------------------------------------------------------- setup (run by hand from the editor)

/** Creates the two tabs, the 5-minute timer and the site key, and checks the PDF can be fetched. Safe to rerun. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  setupTab_(ss, SIGNUPS, SIGNUP_HEADERS);
  setupTab_(ss, OUTBOX, OUTBOX_HEADERS);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(blank);
  const hasTimer = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sendDue'; });
  if (!hasTimer) ScriptApp.newTrigger('sendDue').timeBased().everyMinutes(5).create();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SITE_KEY')) props.setProperty('SITE_KEY', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  attachment_(ATTACH_HOSTS[0] + PDF_PATH);
  console.log('Setup done (' + VERSION + '). Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone), then run showSiteKey.');
}

function setupTab_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  const width = sheet.getLastColumn();
  const have = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
  const missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
  const start = have.filter(String).length ? have.length + 1 : 1;
  if (missing.length) sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (sheet.getMaxRows() > 1) sheet.getRange(2, 1, sheet.getMaxRows() - 1, sheet.getMaxColumns()).setNumberFormat('@');
  return sheet;
}

/** Prints the key the website sends with each request. Paste it into Vercel's GUIDE_SCRIPT_KEY. */
function showSiteKey() {
  console.log('GUIDE_SCRIPT_KEY: ' + PropertiesService.getScriptProperties().getProperty('SITE_KEY'));
}
