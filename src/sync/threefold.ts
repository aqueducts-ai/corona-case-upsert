import { config } from '../config.js';

// Rate limiting: minimum ms between API calls
const MIN_REQUEST_INTERVAL_MS = 200;
let lastRequestTime = 0;

/**
 * Ensure minimum interval between Threefold API calls.
 * Prevents overwhelming the API with rapid requests.
 */
async function rateLimitedRequest(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    const waitTime = MIN_REQUEST_INTERVAL_MS - elapsed;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
}

// ============ Ticket Search & Custom Fields API ============

/**
 * Response from ticket search API.
 */
interface TicketSearchResponse {
  success: boolean;
  data: {
    tickets: Array<{
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
    }>;
    pagination: {
      limit: number;
      offset: number;
      total: number;
      has_more: boolean;
    };
  };
}

/**
 * Ticket with custom fields from search result.
 */
export interface TicketWithCustomFields {
  id: number;
  shortId: string;
  title: string;
  description: string;
  address: string;
  priority: string;
  statusId: number;
  statusName: string;
  ticketTypeId: number;
  ticketTypeName: string;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Search tickets by custom field values.
 * Uses the external tickets search API.
 */
export async function searchTicketsByCustomField(
  customFields: Record<string, unknown>,
  options?: {
    limit?: number;
    offset?: number;
    includeClosed?: boolean;
  }
): Promise<{ tickets: TicketWithCustomFields[]; total: number; hasMore: boolean }> {
  await rateLimitedRequest();

  const body: Record<string, unknown> = {
    custom_fields: customFields,
    limit: options?.limit ?? 50,
    offset: options?.offset ?? 0,
    include_closed: options?.includeClosed ?? true,
  };

  const response = await fetch(
    `${config.threefoldApiUrl}/api/external/tickets/search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.threefoldApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to search tickets: ${response.status} ${error}`);
  }

  const data = await response.json() as TicketSearchResponse;

  const tickets = (data.data?.tickets || []).map(t => ({
    id: t.id,
    shortId: t.short_id,
    title: t.ticket_title,
    description: t.ticket_description,
    address: t.ticket_address,
    priority: t.priority,
    statusId: t.status_id,
    statusName: t.status_name,
    ticketTypeId: t.ticket_type_id,
    ticketTypeName: t.ticket_type_name,
    customFields: t.custom_fields || {},
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));

  return {
    tickets,
    total: data.data?.pagination?.total ?? tickets.length,
    hasMore: data.data?.pagination?.has_more ?? false,
  };
}

// Flag to track if search API is available (avoids repeated failed calls)
let searchApiAvailable = true;

/**
 * Get a ticket by its ID.
 * Used when we have a cached ticket ID and don't need to search.
 */
export async function getTicketById(ticketId: number): Promise<TicketWithCustomFields | null> {
  await rateLimitedRequest();

  const response = await fetch(
    `${config.threefoldApiUrl}/api/external/tickets/${ticketId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.threefoldApiToken}`,
      },
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get ticket: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    success: boolean;
    data: {
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

  const t = data.data;
  return {
    id: t.id,
    shortId: t.short_id,
    title: t.ticket_title,
    description: t.ticket_description,
    address: t.ticket_address,
    priority: t.priority,
    statusId: t.status_id,
    statusName: t.status_name,
    ticketTypeId: t.ticket_type_id,
    ticketTypeName: t.ticket_type_name,
    customFields: t.custom_fields || {},
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

/**
 * Find a ticket by cc_case_number custom field.
 * Returns null if no ticket found or if search API is not available.
 */
export async function findTicketByCaseNumber(caseNo: string): Promise<TicketWithCustomFields | null> {
  // Skip API call if we already know search isn't available
  if (!searchApiAvailable) {
    return null;
  }

  try {
    const result = await searchTicketsByCustomField(
      { cc_case_number: caseNo },
      { limit: 1, includeClosed: true }
    );

    return result.tickets[0] ?? null;
  } catch (error) {
    // If the search API is not available (405), disable future calls and return null
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('405')) {
      console.log(`[THREEFOLD] Search API not available (405), disabling ticket search for this session`);
      searchApiAvailable = false;
      return null;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Custom fields for Code Compliance Case updates.
 */
export interface CodeComplianceCustomFields {
  cc_case_number?: string;
  last_case_status?: 'open' | 'closed';
  cc_case_opened?: string; // YYYY-MM-DD format
  case_close_date?: string | null; // YYYY-MM-DD format or null
}

/**
 * Update a ticket's custom fields.
 * Uses POST /api/external/tickets/{id}/custom-fields endpoint.
 */
export async function updateTicketCustomFields(
  ticketId: number,
  customFields: CodeComplianceCustomFields
): Promise<void> {
  await rateLimitedRequest();

  const body = {
    custom_fields: customFields,
  };

  const response = await fetch(
    `${config.threefoldApiUrl}/api/external/tickets/${ticketId}/custom-fields`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.threefoldApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update ticket custom fields: ${response.status} ${error}`);
  }

  console.log(`[THREEFOLD] Updated custom fields for ticket #${ticketId}`);
}

/**
 * Add a comment to a Threefold ticket.
 */
export async function addTicketComment(ticketId: number, content: string): Promise<void> {
  await rateLimitedRequest();

  const formData = new FormData();
  formData.append('ticket_id', ticketId.toString());
  formData.append('content', content);

  const response = await fetch(`${config.threefoldApiUrl}/api/comments/external`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.threefoldApiToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to add comment: ${response.status} ${error}`);
  }

  console.log(`[THREEFOLD] Added comment to ticket #${ticketId}`);
}
