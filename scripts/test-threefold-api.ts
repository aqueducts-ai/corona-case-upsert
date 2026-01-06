/**
 * Test script for Threefold API endpoints used by this service.
 *
 * Usage: npx tsx scripts/test-threefold-api.ts
 *
 * Tests:
 * 1. POST /api/external/tickets/search - Search tickets by custom field
 * 2. GET /api/external/tickets/{id} - Get ticket by ID
 * 3. PATCH /api/tickets/{id} - Update ticket custom fields (dry run)
 * 4. POST /api/comments/external - Add comment to ticket (dry run)
 */

import 'dotenv/config';

const THREEFOLD_API_URL = process.env.THREEFOLD_API_URL;
const THREEFOLD_API_TOKEN = process.env.THREEFOLD_API_TOKEN;

// Parse CLI arguments
const args = process.argv.slice(2);
const MANUAL_TICKET_ID = args.find(a => a.startsWith('--ticket-id='))?.split('=')[1];
const MANUAL_CASE_NO = args.find(a => a.startsWith('--case-no='))?.split('=')[1];
const ADD_REAL_COMMENT = args.includes('--add-comment');

if (!THREEFOLD_API_URL || !THREEFOLD_API_TOKEN) {
  console.error('Missing required environment variables: THREEFOLD_API_URL, THREEFOLD_API_TOKEN');
  console.error('\nUsage: npx tsx scripts/test-threefold-api.ts [options]');
  console.error('Options:');
  console.error('  --ticket-id=123     Use specific ticket ID for testing');
  console.error('  --case-no=CE24-001  Search for specific case number');
  console.error('  --add-comment       Actually add a test comment (default: skip)');
  process.exit(1);
}

interface TestResult {
  name: string;
  endpoint: string;
  method: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  responseStatus?: number;
  responseData?: unknown;
}

const results: TestResult[] = [];

async function testSearchTickets(): Promise<{ ticketId: number | null; caseNo: string | null }> {
  const name = 'Search Tickets by Custom Field';
  const endpoint = '/api/external/tickets/search';
  const method = 'POST';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`${method} ${endpoint}`);
  console.log('='.repeat(60));

  // Try a few different case number patterns to find a real ticket
  const testCaseNumbers = MANUAL_CASE_NO
    ? [MANUAL_CASE_NO]
    : ['CE24-0001', 'CE23-0001', 'CE22-0001', 'CE21-0001', 'CE24-0100', 'CE23-0100', 'CE24-0500'];

  for (const caseNo of testCaseNumbers) {
    console.log(`\nTrying case number: ${caseNo}`);

    try {
      const body = {
        custom_fields: { cc_case_number: caseNo },
        limit: 1,
        offset: 0,
        include_closed: true,
      };

      const response = await fetch(`${THREEFOLD_API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json() as {
          success?: boolean;
          data?: {
            tickets?: Array<{ id: number; custom_fields?: Record<string, unknown> }>;
            pagination?: { total: number };
          };
        };

        if (data.data?.tickets && data.data.tickets.length > 0) {
          const ticket = data.data.tickets[0];
          console.log(`Found ticket #${ticket.id} for case ${caseNo}`);

          results.push({
            name,
            endpoint,
            method,
            status: 'PASS',
            message: `Search works. Found ticket #${ticket.id} for case ${caseNo}`,
            responseStatus: response.status,
          });

          return { ticketId: ticket.id, caseNo };
        }
      }
    } catch {
      // Continue to next case number
    }
  }

  // If no tickets found with known patterns, test that the endpoint at least works
  console.log('\nNo tickets found with test case numbers. Testing endpoint with empty result...');

  try {
    const body = {
      custom_fields: { cc_case_number: 'TEST-NONEXISTENT-12345' },
      limit: 1,
      offset: 0,
      include_closed: true,
    };

    console.log('Request body:', JSON.stringify(body, null, 2));

    const response = await fetch(`${THREEFOLD_API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    let responseData: unknown;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    console.log(`Response status: ${response.status}`);
    console.log('Response:', JSON.stringify(responseData, null, 2).slice(0, 1000));

    if (!response.ok) {
      results.push({
        name,
        endpoint,
        method,
        status: 'FAIL',
        message: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
        responseStatus: response.status,
        responseData,
      });
      return { ticketId: null, caseNo: null };
    }

    // Validate response structure
    const data = responseData as {
      success?: boolean;
      data?: {
        tickets?: Array<{
          id: number;
          short_id: string;
          ticket_title: string;
          custom_fields?: Record<string, unknown>;
        }>;
        pagination?: {
          total: number;
          has_more: boolean;
        };
      };
    };

    const validationErrors: string[] = [];

    if (typeof data.success !== 'boolean') {
      validationErrors.push('Missing or invalid "success" field');
    }

    if (!data.data) {
      validationErrors.push('Missing "data" field');
    } else {
      if (!Array.isArray(data.data.tickets)) {
        validationErrors.push('Missing or invalid "data.tickets" array');
      }
      if (!data.data.pagination) {
        validationErrors.push('Missing "data.pagination" field');
      }
    }

    if (validationErrors.length > 0) {
      results.push({
        name,
        endpoint,
        method,
        status: 'FAIL',
        message: `Response validation failed: ${validationErrors.join(', ')}`,
        responseStatus: response.status,
        responseData,
      });
      return { ticketId: null, caseNo: null };
    }

    const ticket = data.data?.tickets?.[0];
    const ticketId = ticket?.id ?? null;
    const caseNo = ticket?.custom_fields?.cc_case_number as string | null;

    results.push({
      name,
      endpoint,
      method,
      status: 'PASS',
      message: `Found ${data.data?.pagination?.total ?? 0} tickets. Sample ticket ID: ${ticketId}`,
      responseStatus: response.status,
    });

    return { ticketId, caseNo };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      endpoint,
      method,
      status: 'FAIL',
      message: `Error: ${message}`,
    });
    return { ticketId: null, caseNo: null };
  }
}

async function testGetTicketById(ticketId: number | null): Promise<void> {
  const name = 'Get Ticket by ID';
  const endpoint = `/api/external/tickets/${ticketId ?? '{id}'}`;
  const method = 'GET';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`${method} ${endpoint}`);
  console.log('='.repeat(60));

  if (!ticketId) {
    console.log('SKIP: No ticket ID available from search test');
    results.push({
      name,
      endpoint,
      method,
      status: 'SKIP',
      message: 'No ticket ID available from search test',
    });
    return;
  }

  try {
    const response = await fetch(`${THREEFOLD_API_URL}/api/external/tickets/${ticketId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
      },
    });

    const responseText = await response.text();
    let responseData: unknown;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    console.log(`Response status: ${response.status}`);
    console.log('Response:', JSON.stringify(responseData, null, 2).slice(0, 1000));

    if (!response.ok) {
      results.push({
        name,
        endpoint,
        method,
        status: 'FAIL',
        message: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
        responseStatus: response.status,
        responseData,
      });
      return;
    }

    // Validate response structure
    const data = responseData as {
      success?: boolean;
      data?: {
        id: number;
        short_id: string;
        ticket_title: string;
        ticket_description: string;
        ticket_address: string;
        priority: string;
        status_id: number;
        status_name: string;
        ticket_type_id: number;
        ticket_type_name: string;
        custom_fields: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      };
    };

    const validationErrors: string[] = [];
    const requiredFields = [
      'id', 'short_id', 'ticket_title', 'ticket_address',
      'status_id', 'ticket_type_id', 'custom_fields'
    ];

    if (!data.data) {
      validationErrors.push('Missing "data" field');
    } else {
      for (const field of requiredFields) {
        if (!(field in data.data)) {
          validationErrors.push(`Missing "data.${field}" field`);
        }
      }
    }

    if (validationErrors.length > 0) {
      results.push({
        name,
        endpoint,
        method,
        status: 'FAIL',
        message: `Response validation failed: ${validationErrors.join(', ')}`,
        responseStatus: response.status,
        responseData,
      });
      return;
    }

    results.push({
      name,
      endpoint,
      method,
      status: 'PASS',
      message: `Got ticket #${data.data?.id}: "${data.data?.ticket_title?.slice(0, 50)}"`,
      responseStatus: response.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      endpoint,
      method,
      status: 'FAIL',
      message: `Error: ${message}`,
    });
  }
}

async function testUpdateTicketCustomFields(ticketId: number | null): Promise<void> {
  const name = 'Update Ticket Custom Fields (DRY RUN)';
  const endpoint = `/api/external/tickets/${ticketId ?? '{id}'}/custom-fields`;
  const method = 'POST';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`${method} ${endpoint}`);
  console.log('='.repeat(60));

  if (!ticketId) {
    console.log('SKIP: No ticket ID available from search test');
    results.push({
      name,
      endpoint,
      method,
      status: 'SKIP',
      message: 'No ticket ID available from search test',
    });
    return;
  }

  // First, get current custom fields
  try {
    const getResponse = await fetch(`${THREEFOLD_API_URL}/api/external/tickets/${ticketId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
      },
    });

    if (!getResponse.ok) {
      results.push({
        name,
        endpoint,
        method,
        status: 'FAIL',
        message: `Could not get current ticket state: HTTP ${getResponse.status}`,
        responseStatus: getResponse.status,
      });
      return;
    }

    const currentData = await getResponse.json() as {
      data: { custom_fields: Record<string, unknown> };
    };
    const currentFields = currentData.data.custom_fields;

    console.log('Current custom_fields:', JSON.stringify(currentFields, null, 2));

    // Test the POST custom-fields endpoint by setting the same values (no actual change)
    const body = {
      custom_fields: {
        cc_case_opened: currentFields.cc_case_opened ?? null,
        case_close_date: currentFields.case_close_date ?? null,
        last_case_status: currentFields.last_case_status ?? null,
      },
    };

    console.log('Request body (same values - no change):', JSON.stringify(body, null, 2));

    const response = await fetch(`${THREEFOLD_API_URL}/api/external/tickets/${ticketId}/custom-fields`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    let responseData: unknown;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    console.log(`Response status: ${response.status}`);
    console.log('Response:', JSON.stringify(responseData, null, 2).slice(0, 500));

    if (!response.ok) {
      results.push({
        name,
        endpoint,
        method,
        status: 'FAIL',
        message: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
        responseStatus: response.status,
        responseData,
      });
      return;
    }

    results.push({
      name,
      endpoint,
      method,
      status: 'PASS',
      message: `POST custom-fields endpoint works`,
      responseStatus: response.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      endpoint,
      method,
      status: 'FAIL',
      message: `Error: ${message}`,
    });
  }
}

async function testAddComment(ticketId: number | null): Promise<void> {
  const name = 'Add Comment to Ticket';
  const endpoint = '/api/comments/external';
  const method = 'POST';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`${method} ${endpoint}`);
  console.log('='.repeat(60));

  if (!ticketId) {
    console.log('SKIP: No ticket ID available from search test');
    results.push({
      name,
      endpoint,
      method,
      status: 'SKIP',
      message: 'No ticket ID available from search test',
    });
    return;
  }

  try {
    if (ADD_REAL_COMMENT) {
      // Actually add a test comment
      console.log('Adding REAL comment to ticket...');

      const formData = new FormData();
      formData.append('ticket_id', ticketId.toString());
      formData.append('content', `[API Test] Test comment from test-threefold-api.ts at ${new Date().toISOString()}`);

      const response = await fetch(`${THREEFOLD_API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
        },
        body: formData,
      });

      const responseText = await response.text();
      console.log(`Response status: ${response.status}`);
      console.log('Response:', responseText.slice(0, 500));

      if (!response.ok) {
        results.push({
          name,
          endpoint,
          method,
          status: 'FAIL',
          message: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
          responseStatus: response.status,
        });
        return;
      }

      results.push({
        name,
        endpoint,
        method,
        status: 'PASS',
        message: `Successfully added comment to ticket #${ticketId}`,
        responseStatus: response.status,
      });
    } else {
      // Test endpoint with invalid data to verify it exists
      console.log('\n⚠️  Skipping real comment. Use --add-comment flag to test.');
      console.log('    Testing endpoint availability with invalid data...\n');

      const formData = new FormData();
      formData.append('ticket_id', '0');
      formData.append('content', '');

      const response = await fetch(`${THREEFOLD_API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
        },
        body: formData,
      });

      const responseText = await response.text();
      console.log(`Response status: ${response.status}`);
      console.log('Response:', responseText.slice(0, 500));

      // 404/405 means endpoint doesn't exist
      if (response.status === 404 || response.status === 405) {
        results.push({
          name,
          endpoint,
          method,
          status: 'FAIL',
          message: `Endpoint not found or not allowed: HTTP ${response.status}`,
          responseStatus: response.status,
        });
        return;
      }

      results.push({
        name,
        endpoint,
        method,
        status: 'PASS',
        message: `Endpoint exists (HTTP ${response.status} with invalid test data). Use --add-comment to test fully.`,
        responseStatus: response.status,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      endpoint,
      method,
      status: 'FAIL',
      message: `Error: ${message}`,
    });
  }
}

async function resolveShortId(shortId: string): Promise<number | null> {
  try {
    // Use the external tickets endpoint with short_id parameter
    const response = await fetch(
      `${THREEFOLD_API_URL}/api/external/tickets/by-short-id/${shortId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      // Try searching by short_id in the search endpoint
      const searchBody = {
        short_id: shortId,
        limit: 1,
      };

      const searchResponse = await fetch(
        `${THREEFOLD_API_URL}/api/external/tickets/search`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${THREEFOLD_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchBody),
        }
      );

      if (searchResponse.ok) {
        const data = await searchResponse.json() as {
          data?: { tickets?: Array<{ id: number }> };
        };
        return data.data?.tickets?.[0]?.id ?? null;
      }

      return null;
    }

    const data = await response.json() as { data?: { id: number } };
    return data.data?.id ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('\n');
  console.log('#'.repeat(60));
  console.log('# THREEFOLD API ENDPOINT TESTS');
  console.log('#'.repeat(60));
  console.log(`\nAPI URL: ${THREEFOLD_API_URL}`);
  console.log(`Token: ${THREEFOLD_API_TOKEN?.slice(0, 10)}...`);

  if (MANUAL_TICKET_ID) {
    console.log(`Manual ticket ID: ${MANUAL_TICKET_ID}`);
  }
  if (MANUAL_CASE_NO) {
    console.log(`Manual case number: ${MANUAL_CASE_NO}`);
  }
  if (ADD_REAL_COMMENT) {
    console.log(`⚠️  Will add REAL comment to ticket`);
  }

  // Run tests
  let ticketId: number | null = null;

  if (MANUAL_TICKET_ID) {
    // Check if it's a short_id (contains dash like "2026-16") or numeric ID
    if (MANUAL_TICKET_ID.includes('-')) {
      console.log(`\nResolving short_id ${MANUAL_TICKET_ID} to numeric ID...`);
      ticketId = await resolveShortId(MANUAL_TICKET_ID);
      if (ticketId) {
        console.log(`Resolved to ticket #${ticketId}`);
      } else {
        console.log(`Could not resolve short_id ${MANUAL_TICKET_ID}`);
      }
    } else {
      ticketId = parseInt(MANUAL_TICKET_ID, 10);
    }
  }

  if (!ticketId) {
    const searchResult = await testSearchTickets();
    ticketId = searchResult.ticketId;
  } else {
    results.push({
      name: 'Search Tickets by Custom Field',
      endpoint: '/api/external/tickets/search',
      method: 'POST',
      status: 'SKIP',
      message: `Using manual ticket ID: ${ticketId}`,
    });
  }

  await testGetTicketById(ticketId);
  await testUpdateTicketCustomFields(ticketId);
  await testAddComment(ticketId);

  // Print summary
  console.log('\n');
  console.log('#'.repeat(60));
  console.log('# TEST SUMMARY');
  console.log('#'.repeat(60));
  console.log('');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  for (const result of results) {
    const statusIcon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '○';
    const statusColor = result.status === 'PASS' ? '\x1b[32m' : result.status === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
    console.log(`${statusColor}${statusIcon}\x1b[0m ${result.name}`);
    console.log(`  ${result.method} ${result.endpoint}`);
    console.log(`  ${result.message}`);
    console.log('');
  }

  console.log('-'.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
