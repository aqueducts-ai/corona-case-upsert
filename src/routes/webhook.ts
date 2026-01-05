import { Router } from 'express';
import busboy from 'busboy';
import { parseCodeEnforcementCasesCsv } from '../parsers/code-enforcement-cases.js';
import { processCasesSync } from '../sync/cases-sync.js';

export const webhookRouter = Router();

interface ParsedEmail {
  from: string;
  to: string;
  subject: string;
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

/**
 * POST /webhook/sendgrid
 *
 * Receives inbound email from SendGrid Inbound Parse.
 * Only processes Code Enforcement Cases CSV attachments.
 */
webhookRouter.post('/sendgrid', (req, res) => {
  const email: ParsedEmail = {
    from: '',
    to: '',
    subject: '',
    attachments: [],
  };

  const bb = busboy({ headers: req.headers });

  bb.on('field', (name: string, val: string) => {
    if (name === 'from') email.from = val;
    if (name === 'to') email.to = val;
    if (name === 'subject') email.subject = val;
  });

  bb.on('file', (name: string, file: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
    const chunks: Buffer[] = [];

    file.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    file.on('end', () => {
      const content = Buffer.concat(chunks);
      email.attachments.push({
        filename: info.filename,
        content,
        contentType: info.mimeType,
      });
    });
  });

  bb.on('finish', async () => {
    const timestamp = new Date().toISOString();
    console.log('');
    console.log('='.repeat(60));
    console.log(`[WEBHOOK] ${timestamp} - Email received`);
    console.log('='.repeat(60));
    console.log(`[WEBHOOK] From: ${email.from}`);
    console.log(`[WEBHOOK] Subject: ${email.subject}`);
    console.log(`[WEBHOOK] Attachments: ${email.attachments.length}`);
    email.attachments.forEach(a => console.log(`  - ${a.filename} (${(a.content.length / 1024).toFixed(1)} KB)`));
    console.log('-'.repeat(60));

    try {
      const subjectLower = email.subject.toLowerCase();
      const filenameLower = email.attachments.map(a => a.filename.toLowerCase()).join(' ');

      // Only process Code Enforcement Cases emails
      const isCaseEmail =
        subjectLower.includes('code_enforcement_cases') ||
        subjectLower.includes('code enforcement cases') ||
        filenameLower.includes('code_enforcement_cases') ||
        filenameLower.includes('code enforcement cases');

      if (!isCaseEmail) {
        console.log(`[WEBHOOK] Not a Code Enforcement Cases email, ignoring`);
        res.status(200).json({ success: true, message: 'Ignored - not a Code Enforcement Cases email' });
        return;
      }

      console.log(`[WEBHOOK] Code Enforcement Cases email detected`);

      // Process each CSV attachment
      for (const attachment of email.attachments) {
        if (!attachment.filename.endsWith('.csv')) {
          console.log(`[WEBHOOK] Skipping non-CSV: ${attachment.filename}`);
          continue;
        }

        console.log(`[WEBHOOK] Processing: ${attachment.filename}`);
        const csvContent = attachment.content.toString('utf-8');
        const cases = await parseCodeEnforcementCasesCsv(csvContent);
        console.log(`[PARSE] Parsed ${cases.length} case records`);
        await processCasesSync(cases);
      }

      console.log('-'.repeat(60));
      console.log(`[WEBHOOK] Processing complete`);
      console.log('='.repeat(60));
      console.log('');
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[WEBHOOK] Error processing email:', error);
      res.status(500).json({ error: 'Failed to process email' });
    }
  });

  bb.on('error', (err: Error) => {
    console.error('Busboy error:', err);
    res.status(400).json({ error: 'Failed to parse email' });
  });

  req.pipe(bb);
});
