import { config } from '../config.js';
import { CodeEnforcementCaseRecord } from '../parsers/code-enforcement-cases.js';
import {
  diffCases,
  upsertCaseState,
  createSyncLog,
  completeSyncLog,
  determineCaseStatus,
  updateCaseThreefoldId,
  CaseStateChange,
} from '../state/tracker.js';
import {
  findTicketByCaseNumber,
  getTicketById,
  updateTicketCustomFields,
  CodeComplianceCustomFields,
} from './threefold.js';

/**
 * Process Code Enforcement Cases sync.
 *
 * Logic:
 * 1. Compare incoming CSV against local case_state table to find changes
 * 2. For each changed case (new or updated), find the matching ticket by cc_case_number
 * 3. Compare ticket's current custom fields against what we want to set
 * 4. Only make API call if there's an actual diff
 * 5. Save all records to local state for next sync comparison
 *
 * Custom fields updated:
 * - cc_case_opened: case opened date (YYYY-MM-DD)
 * - case_close_date: case closed date (YYYY-MM-DD or null)
 * - last_case_status: 'open' or 'closed' based on dates
 */
export async function processCasesSync(records: CodeEnforcementCaseRecord[]): Promise<void> {
  const syncId = await createSyncLog('cases');
  const startTime = Date.now();

  console.log('');
  console.log('='.repeat(60));
  console.log(`[CASE SYNC] Starting sync for ${records.length} records`);
  console.log('='.repeat(60));

  try {
    // Get changes by comparing against stored state
    // This returns cases that are either:
    // - New (not in our local DB yet)
    // - Changed (dates differ from what we last saw)
    const changes = await diffCases(records);

    console.log(`[CASE SYNC] Found ${changes.length} changes out of ${records.length} records`);

    if (changes.length === 0) {
      console.log('[CASE SYNC] No changes detected, skipping API updates');
      // Still update last_seen_at timestamps
      await upsertCaseState(records);
      await completeSyncLog(syncId, records.length, 0, 0);
      return;
    }

    // Log changes summary
    const newCases = changes.filter(c => c.isNew);
    const updatedCases = changes.filter(c => !c.isNew);
    console.log(`[CASE SYNC] New cases (first time seen): ${newCases.length}`);
    console.log(`[CASE SYNC] Updated cases (dates changed): ${updatedCases.length}`);

    let processed = 0;
    let updated = 0;
    let notFound = 0;
    let noChanges = 0;
    let errors = 0;

    // Process each change - both new and updated cases
    for (const change of changes) {
      processed++;
      const progressPct = Math.round((processed / changes.length) * 100);
      const changeType = change.isNew ? 'NEW' : 'UPDATED';

      try {
        // Check if API updates are enabled
        if (!config.caseUpdatesEnabled) {
          console.log(`[CASE SYNC] [${progressPct}%] DRY RUN: Would process ${changeType} case ${change.caseNo}`);
          continue;
        }

        // Find ticket - use cached ID if available, otherwise search by custom field
        let ticket;
        if (change.threefoldTicketId) {
          // Use cached ticket ID - skip search API call
          ticket = await getTicketById(change.threefoldTicketId);
          if (!ticket) {
            // Cached ID no longer valid, try searching
            console.log(`[CASE SYNC] [${progressPct}%] Cached ticket #${change.threefoldTicketId} not found, searching by case number`);
            ticket = await findTicketByCaseNumber(change.caseNo);
          }
        } else {
          // No cached ID - search by cc_case_number custom field
          ticket = await findTicketByCaseNumber(change.caseNo);
        }

        if (!ticket) {
          console.log(`[CASE SYNC] [${progressPct}%] No ticket found for ${changeType} case ${change.caseNo}`);
          notFound++;
          continue;
        }

        // Compare against Threefold's current custom field values
        // This is the key diff check - only update if values actually differ
        const existingFields = ticket.customFields as Partial<CodeComplianceCustomFields>;
        const newStatus = determineCaseStatus(change.record.caseOpened, change.record.caseClosed);

        // Normalize comparisons (handle null vs undefined vs empty string)
        const currentOpened = existingFields.cc_case_opened || null;
        const currentClosed = existingFields.case_close_date || null;
        const currentStatus = existingFields.last_case_status || null;

        const wantOpened = change.record.caseOpened || null;
        const wantClosed = change.record.caseClosed || null;
        const wantStatus = newStatus;

        const hasOpenedChange = currentOpened !== wantOpened;
        const hasClosedChange = currentClosed !== wantClosed;
        const hasStatusChange = currentStatus !== wantStatus;

        if (!hasOpenedChange && !hasClosedChange && !hasStatusChange) {
          console.log(`[CASE SYNC] [${progressPct}%] No diff for ${changeType} case ${change.caseNo} (ticket #${ticket.id}) - Threefold already up to date`);
          // Cache the ticket ID for future reference
          await updateCaseThreefoldId(change.caseNo, ticket.id);
          noChanges++;
          continue;
        }

        // Build update payload - only include fields that changed
        const updateFields: CodeComplianceCustomFields = {};

        if (hasOpenedChange && wantOpened) {
          updateFields.cc_case_opened = wantOpened;
        }

        if (hasClosedChange) {
          updateFields.case_close_date = wantClosed;
        }

        if (hasStatusChange) {
          updateFields.last_case_status = wantStatus;
        }

        // Log what we're updating
        const updateSummary: string[] = [];
        if (hasOpenedChange) {
          updateSummary.push(`opened: ${currentOpened ?? 'null'} → ${wantOpened ?? 'null'}`);
        }
        if (hasClosedChange) {
          updateSummary.push(`closed: ${currentClosed ?? 'null'} → ${wantClosed ?? 'null'}`);
        }
        if (hasStatusChange) {
          updateSummary.push(`status: ${currentStatus ?? 'null'} → ${wantStatus}`);
        }

        console.log(`[CASE SYNC] [${progressPct}%] Updating ${changeType} case ${change.caseNo} (ticket #${ticket.id}): ${updateSummary.join(', ')}`);

        // Update ticket custom fields in Threefold
        await updateTicketCustomFields(ticket.id, updateFields);

        // Cache the ticket ID
        await updateCaseThreefoldId(change.caseNo, ticket.id);

        updated++;
      } catch (err) {
        console.error(`[CASE SYNC] Error processing case ${change.caseNo}:`, err);
        errors++;
      }
    }

    // Save ALL records to local state
    // This ensures we track what we've seen for next sync's diff comparison
    await upsertCaseState(records);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('-'.repeat(60));
    console.log(`[CASE SYNC] Sync complete in ${duration}s`);
    console.log(`[CASE SYNC] Summary:`);
    console.log(`  - Processed: ${processed} changes`);
    console.log(`  - Updated in Threefold: ${updated}`);
    console.log(`  - No ticket found: ${notFound}`);
    console.log(`  - Already up to date: ${noChanges}`);
    console.log(`  - Errors: ${errors}`);
    console.log('='.repeat(60));
    console.log('');

    await completeSyncLog(syncId, records.length, updated, errors);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[CASE SYNC] Fatal error:', err);
    await completeSyncLog(syncId, records.length, 0, 1, errorMessage);
    throw err;
  }
}
