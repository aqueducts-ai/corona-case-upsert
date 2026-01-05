# Custom Fields Integration Guide for Third-Party Developers

This guide explains how to use Custom Fields when creating and updating tickets via the Threefold API. Custom Fields allow organizations to capture additional structured data beyond the standard ticket fields.

## Overview

Custom Fields provide:
- **Flexible field definitions** - Boolean, string, number, date, select, multi_select types
- **Type-aware validation** - Automatic validation against field definitions
- **Visibility control** - Per-ticket-type configuration (fields can be visible/required for specific ticket types)
- **Activity logging** - All changes are automatically tracked in the activity log

## Authentication

All endpoints require authentication via Integration JWT Token in the `Authorization` header:

```bash
curl -X POST https://app.threefold.ai/api/tickets \
  -H "Authorization: Bearer YOUR_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

### Required Role

Your integration token must have appropriate permissions:
- **Read**: Any authenticated integration
- **Write/Update**: Admin, owner, or super-admin role

## Getting Custom Field Definitions

Before creating or updating tickets with custom fields, you should retrieve the field definitions to know which fields exist, their types, and validation rules.

### Endpoint

```
GET /api/custom-fields/definitions
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `active_only` | boolean | `true` | Only return active fields |
| `include_options` | boolean | `false` | Include select options for select/multi_select fields |
| `include_groups` | boolean | `false` | Include category/group information |
| `group_id` | number | - | Filter by specific group ID |

### Example Request

```bash
curl -X GET "https://app.threefold.ai/api/custom-fields/definitions?include_options=true&include_groups=true" \
  -H "Authorization: Bearer YOUR_MCP_TOKEN"
```

### Example Response

```json
{
  "definitions": [
    {
      "id": 1,
      "organization_id": "org_abc123",
      "name": "Property ID",
      "field_key": "property_id",
      "field_type": "string",
      "description": "Unique property identifier",
      "validation_regex": "^[A-Z0-9-]+$",
      "default_value": null,
      "is_active": true,
      "sort_order": 0,
      "field_group_id": 5,
      "category": {
        "id": 5,
        "name": "Property Information"
      }
    },
    {
      "id": 2,
      "organization_id": "org_abc123",
      "name": "Severity Level",
      "field_key": "severity_level",
      "field_type": "select",
      "description": "Issue severity",
      "default_value": "medium",
      "is_active": true,
      "sort_order": 1,
      "options": [
        { "id": 101, "label": "Low", "value": "low", "color": "#22c55e", "sort_order": 0 },
        { "id": 102, "label": "Medium", "value": "medium", "color": "#f59e0b", "sort_order": 1 },
        { "id": 103, "label": "High", "value": "high", "color": "#ef4444", "sort_order": 2 }
      ]
    },
    {
      "id": 3,
      "organization_id": "org_abc123",
      "name": "Inspection Required",
      "field_key": "inspection_required",
      "field_type": "boolean",
      "default_value": false,
      "is_active": true,
      "sort_order": 2
    }
  ]
}
```

### Key Fields in Response

| Field | Description |
|-------|-------------|
| `field_key` | **Use this** when setting values on tickets (snake_case identifier) |
| `field_type` | Data type: `boolean`, `string`, `number`, `date`, `select`, `multi_select` |
| `validation_regex` | For `string` fields, values must match this pattern |
| `options` | For `select`/`multi_select` fields, the valid option values |
| `default_value` | Pre-populated value if none provided |
| `is_active` | Whether the field is currently active |

### Getting Field Visibility by Ticket Type

Fields can be configured as visible/hidden and optional/required per ticket type. Use this endpoint to know which fields are required for a specific ticket type:

```
GET /api/custom-fields/visibility?ticket_type_id=5
```

**Response:**

```json
{
  "visibility": [
    {
      "field_id": 1,
      "ticket_type_id": 5,
      "is_visible": true,
      "is_required": true
    },
    {
      "field_id": 2,
      "ticket_type_id": 5,
      "is_visible": true,
      "is_required": false
    }
  ]
}
```

---

## Data Model

### How Custom Fields Are Stored

Custom field values are stored in the `custom_fields` JSONB column on the `tickets` table:

```json
{
  "property_id": "123-456",
  "building_type": "commercial",
  "inspection_required": true,
  "inspectors": ["inspector_1", "inspector_2"],
  "scheduled_date": "2025-01-20"
}
```

### Field Types

| Field Type | Storage Format | Example Value |
|-----------|----------------|---------------|
| `boolean` | JSON boolean | `true`, `false` |
| `string` | JSON string | `"123 Main St"` |
| `number` | JSON number | `42`, `3.14` |
| `date` | ISO 8601 string | `"2025-01-20"` |
| `select` | JSON string | `"option_value"` |
| `multi_select` | JSON array | `["opt1", "opt2"]` |

### Field Keys

Each custom field has a unique `field_key` (snake_case identifier) generated from the field name:
- "Property ID" → `property_id`
- "Building Type (Primary)" → `building_type_primary`
- "Inspection Required?" → `inspection_required`

**Always use `field_key`, not the field name**, when setting custom field values.

---

## Creating Tickets with Custom Fields

### Endpoint

```
POST /api/tickets
```

### Request Format

```json
{
  "ticket_address": "123 Main St, Anytown, CA 90210",
  "ticket_title": "Pothole repair needed",
  "ticket_description": "Large pothole causing traffic hazards",
  "ticket_type_id": 5,
  "step_id": 10,
  "custom_fields": {
    "property_id": "APN-12345",
    "severity_level": "high",
    "estimated_cost": 2500,
    "inspection_required": true,
    "affected_areas": ["road", "sidewalk"],
    "reported_date": "2025-01-15"
  }
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `ticket_address` | string | Physical address for the ticket |
| `organization_id` | string | Organization ID (from your token context) |

### Optional Fields (Including Custom Fields)

| Field | Type | Description |
|-------|------|-------------|
| `ticket_title` | string | Title of the ticket |
| `ticket_description` | string | Detailed description |
| `ticket_type_id` | number | Ticket type ID |
| `step_id` | number | Initial workflow step ID |
| `status_id` | number | Initial status ID |
| `ticket_assignee` | string | Assignee user ID or department slug |
| `priority` | string | `low`, `medium`, `high`, `urgent` |
| `custom_fields` | object | Key-value pairs of custom field values |

### Response

```json
{
  "id": 12345,
  "short_id": "2025-123",
  "organization_id": "org_abc123",
  "ticket_address": "123 Main St, Anytown, CA 90210",
  "ticket_title": "Pothole repair needed",
  "ticket_type_id": 5,
  "custom_fields": {
    "property_id": "APN-12345",
    "severity_level": "high",
    "estimated_cost": 2500,
    "inspection_required": true,
    "affected_areas": ["road", "sidewalk"],
    "reported_date": "2025-01-15"
  },
  "created_at": "2025-01-15T10:00:00Z"
}
```

---

## Updating Tickets with Custom Fields

### Endpoint

```
PUT /api/tickets/{ticket_id}
PATCH /api/tickets/{ticket_id}
```

Both `PUT` and `PATCH` perform partial updates. Only provided fields are modified.

### Request Format

```json
{
  "custom_fields": {
    "inspection_required": false,
    "actual_cost": 2800,
    "completion_date": "2025-01-25"
  }
}
```

### Merging Behavior

Custom fields are **merged** with existing values:

```
Before:
{
  "property_id": "APN-12345",
  "severity_level": "high",
  "inspection_required": true
}

Update:
{
  "custom_fields": {
    "inspection_required": false,
    "actual_cost": 2800
  }
}

After:
{
  "property_id": "APN-12345",      // Preserved
  "severity_level": "high",        // Preserved
  "inspection_required": false,    // Updated
  "actual_cost": 2800              // Added
}
```

### Clearing Custom Field Values

To clear a custom field value, set it to `null`:

```json
{
  "custom_fields": {
    "scheduled_date": null
  }
}
```

### Response

```json
{
  "id": 12345,
  "short_id": "2025-123",
  "custom_fields": {
    "property_id": "APN-12345",
    "severity_level": "high",
    "inspection_required": false,
    "actual_cost": 2800
  },
  "updated_at": "2025-01-20T14:30:00Z"
}
```

---

## Validation Rules

Custom fields are validated when creating or updating tickets. Validation includes:

### Type Validation

Each value must match its field type:

| Field Type | Valid Values | Invalid Values |
|-----------|--------------|----------------|
| `boolean` | `true`, `false` | `"true"`, `1`, `"yes"` |
| `string` | Any string | Number, boolean, array |
| `number` | Any number (int or float) | `"123"`, `NaN`, `Infinity` |
| `date` | ISO 8601 date string | `"tomorrow"`, timestamp |
| `select` | One of defined option values | Value not in options list |
| `multi_select` | Array of defined option values | Non-array, invalid options |

### Required Fields

If a custom field is marked as **required** for the ticket's type, validation will fail if:
- Value is `null` or `undefined`
- Value is an empty string `""`
- Value is an empty array `[]` (for multi_select)

**Note:** `0` (zero) and `false` are valid values, even for required fields.

### Regex Validation

String fields may have a `validation_regex` pattern. Values must match:

```
Field: "Phone Number"
Regex: "^\d{3}-\d{3}-\d{4}$"

✅ Valid: "555-123-4567"
❌ Invalid: "5551234567", "(555) 123-4567"
```

### Select Option Validation

For `select` and `multi_select` fields, values must be valid option values:

```
Field: "Priority Level"
Options: [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" }
]

✅ Valid: "low", "medium", "high"
❌ Invalid: "Low", "critical", "1"
```

---

## Error Handling

### Validation Error Response

```json
{
  "error": "Validation failed: Property ID is required; Building Type has invalid type. Expected select",
  "status": 400
}
```

### Common Error Codes

| HTTP Status | Error | Cause |
|-------------|-------|-------|
| 400 | Validation failed | Custom field value doesn't match definition |
| 400 | Invalid field type | Value type doesn't match expected type |
| 400 | Required field missing | Required custom field is empty/null |
| 400 | Invalid option | Select value not in options list |
| 400 | Regex mismatch | String doesn't match validation pattern |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Ticket not found | Invalid ticket ID |

### Error Response Format

```json
{
  "error": "string describing the error",
  "details": {
    "field_key": "property_id",
    "field_name": "Property ID",
    "code": "REQUIRED_FIELD_MISSING",
    "message": "Property ID is required"
  }
}
```

---

## Querying Tickets (External API)

The recommended way to query tickets as an external integration is using the dedicated search endpoint:

### Endpoint

```
POST /api/external/tickets/search
```

This endpoint supports filtering by **both standard ticket fields and custom fields**, with full pagination support.

### Request Format

```json
{
  "status_id": 5,
  "ticket_type_id": 3,
  "priority": "high",
  "custom_fields": {
    "cc_case_number": "ABC123",
    "severity_level": ["high", "critical"]
  },
  "limit": 50,
  "offset": 0
}
```

### Available Filters

#### Standard Ticket Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `status_id` | number | Single status ID filter |
| `status_ids` | number[] | Multiple status IDs (OR logic, max 20) |
| `ticket_type_id` | number | Single ticket type ID filter |
| `ticket_type_ids` | number[] | Multiple ticket type IDs (OR logic, max 20) |
| `step_id` | number | Single workflow step ID filter |
| `step_ids` | number[] | Multiple step IDs (OR logic, max 20) |
| `workflow_id` | number | Workflow ID filter |
| `assignee` | string | Assignee user ID or department slug |
| `priority` | string | Single priority (`low`, `medium`, `high`, `urgent`) |
| `priorities` | string[] | Multiple priorities (OR logic) |

#### Text Search

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search in title and description (max 500 chars) |
| `address` | string | Contains match on ticket address (max 500 chars) |

#### Date Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `created_after` | ISO datetime | Tickets created after this date |
| `created_before` | ISO datetime | Tickets created before this date |
| `updated_after` | ISO datetime | Tickets updated after this date |
| `updated_before` | ISO datetime | Tickets updated before this date |

#### Custom Fields Filter

| Parameter | Type | Description |
|-----------|------|-------------|
| `custom_fields` | object | Key-value pairs for filtering (see below) |

#### Pagination & Sorting

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Results per page (max 100) |
| `offset` | number | 0 | Skip N results |
| `sort_by` | string | `created_at` | Sort field: `created_at`, `updated_at`, `priority`, `status_id` |
| `sort_order` | string | `desc` | Sort direction: `asc`, `desc` |

#### Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include_closed` | boolean | false | Include closed/resolved tickets |

### Custom Field Filter Operators

The operator is inferred from the value type:

| Value Type | Operator | Behavior |
|-----------|----------|----------|
| `boolean` | `eq` | Exact match |
| `string` | `ilike` | Case-insensitive contains |
| `string[]` | `in` | Match any value in array |
| `{ min, max }` | `between`/`gte`/`lte` | Numeric range |
| `{ from, to }` | `between`/`gte`/`lte` | Date range |

### Example Request

```bash
curl -X POST https://app.threefold.ai/api/external/tickets/search \
  -H "Authorization: Bearer YOUR_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_type_id": 5,
    "priority": "high",
    "custom_fields": {
      "cc_case_number": "ABC123"
    },
    "include_closed": false,
    "limit": 20,
    "offset": 0,
    "sort_by": "created_at",
    "sort_order": "desc"
  }'
```

### Response Format

```json
{
  "success": true,
  "data": {
    "tickets": [
      {
        "id": 12345,
        "short_id": "2025-123",
        "ticket_title": "Pothole repair needed",
        "ticket_description": "Large pothole at intersection",
        "ticket_address": "123 Main St, Anytown, CA 90210",
        "ticket_parsed_lat": 33.9425,
        "ticket_parsed_lng": -117.9295,
        "priority": "high",
        "status_id": 5,
        "status_name": "In Progress",
        "ticket_type_id": 3,
        "ticket_type_name": "Street Maintenance",
        "step_id": 15,
        "step_name": "Field Work",
        "workflow_id": 2,
        "workflow_name": "Public Works",
        "ticket_assignee": "user_abc123",
        "custom_fields": {
          "cc_case_number": "ABC123",
          "severity_level": "high",
          "estimated_cost": 2500
        },
        "created_at": "2025-01-15T10:00:00Z",
        "updated_at": "2025-01-20T14:30:00Z",
        "closed_at": null
      }
    ],
    "pagination": {
      "limit": 20,
      "offset": 0,
      "total": 45,
      "has_more": true
    }
  },
  "rate_limit": {
    "limit": 6000,
    "remaining": 5999,
    "reset": "2025-01-20T16:00:00.000Z"
  },
  "meta": {
    "processing_time_ms": 125,
    "custom_field_filter_count": 1
  }
}
```

### More Filter Examples

**Find tickets by case number:**
```json
{
  "custom_fields": {
    "cc_case_number": "ABC123"
  }
}
```

**Find high priority tickets with specific custom field:**
```json
{
  "priorities": ["high", "urgent"],
  "custom_fields": {
    "inspection_required": true
  }
}
```

**Find tickets in a date range with cost range:**
```json
{
  "created_after": "2025-01-01T00:00:00Z",
  "created_before": "2025-01-31T23:59:59Z",
  "custom_fields": {
    "estimated_cost": { "min": 1000, "max": 5000 }
  }
}
```

**Find tickets by address containing a street name:**
```json
{
  "address": "Main St",
  "status_ids": [1, 2, 3]
}
```

**Find tickets with multiple custom field criteria:**
```json
{
  "custom_fields": {
    "hazard_level": ["high", "critical"],
    "repair_completed": false,
    "reported_date": { "from": "2025-01-01" }
  }
}
```

---

## Querying Tickets (Internal API)

For internal applications using Clerk authentication, you can also use the internal tickets endpoint with custom field filters:

### Endpoint

```
GET /api/tickets?custom_fields={"property_id":"APN-12345"}
```

### Filter Format

Pass a JSON object as the `custom_fields` query parameter (URL-encoded):

```json
{
  "field_key": "filter_value"
}
```

### Examples

**Exact boolean match:**
```
GET /api/tickets?custom_fields={"inspection_required":true}
```

**Text search (case-insensitive contains):**
```
GET /api/tickets?custom_fields={"property_id":"APN-123"}
```

**Multiple select values (match any):**
```
GET /api/tickets?custom_fields={"severity_level":["high","critical"]}
```

**Numeric range:**
```
GET /api/tickets?custom_fields={"estimated_cost":{"min":1000,"max":5000}}
```

**Date range:**
```
GET /api/tickets?custom_fields={"reported_date":{"from":"2025-01-01","to":"2025-01-31"}}
```

**Combined filters:**
```
GET /api/tickets?custom_fields={"severity_level":"high","inspection_required":true}
```

> **Note:** The internal `/api/tickets` endpoint requires Clerk authentication and is not compatible with MCP tokens. For external integrations, use `/api/external/tickets/search` instead.

---

## Activity Logging

All custom field changes are automatically logged to the activity log with event type `ticket.custom_field_changed`:

```json
{
  "id": 98765,
  "ticket_id": 12345,
  "event_type": "ticket.custom_field_changed",
  "initiated_by": "user_xyz789",
  "details": {
    "field_key": "severity_level",
    "field_name": "Severity Level",
    "old_value": "medium",
    "new_value": "high"
  },
  "created_at": "2025-01-20T14:30:00Z"
}
```

For `multi_select` fields, the log includes added/removed values:

```json
{
  "details": {
    "field_key": "affected_areas",
    "field_name": "Affected Areas",
    "old_value": ["road"],
    "new_value": ["road", "sidewalk", "parking"],
    "added": ["sidewalk", "parking"],
    "removed": []
  }
}
```

---

## Best Practices

### 1. Always Use Field Keys

Use `field_key` (snake_case), not field names:

```json
// ✅ Correct
{ "custom_fields": { "property_id": "123" } }

// ❌ Wrong
{ "custom_fields": { "Property ID": "123" } }
```

### 2. Validate Before Submitting

Fetch field definitions first, then validate locally before API calls to reduce errors.

### 3. Handle Unknown Fields Gracefully

Unknown field keys are ignored during validation. This allows:
- Backward compatibility when fields are added/removed
- Fields configured for different ticket types

### 4. Use Appropriate Types

Match the expected field type exactly:

```json
// ✅ Correct: boolean
{ "inspection_required": true }

// ❌ Wrong: string "true"
{ "inspection_required": "true" }
```

### 5. Respect Visibility Configuration

Only fields marked as `is_visible: true` for the ticket's type will be validated for required status. Fields for other ticket types are ignored.

### 6. Handle Soft-Deleted Fields

Fields can be deactivated (`is_active: false`) but existing data is preserved. Your integration should handle potentially stale field references gracefully.

---

## Rate Limits

- **Read operations**: 100 requests/minute
- **Write operations**: 30 requests/minute
- **Bulk operations**: 10 requests/minute

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705315200
```

---

## Webhooks

You can configure webhooks to receive notifications when custom fields change:

### Event Type

```
ticket.custom_field_changed
```

### Webhook Payload

```json
{
  "event": "ticket.custom_field_changed",
  "ticket_id": 12345,
  "short_id": "2025-123",
  "organization_id": "org_abc123",
  "timestamp": "2025-01-20T14:30:00Z",
  "data": {
    "field_key": "severity_level",
    "field_name": "Severity Level",
    "old_value": "medium",
    "new_value": "high",
    "changed_by": "user_xyz789"
  }
}
```

---

## Complete Example

### Creating a Ticket with Custom Fields

```bash
curl -X POST https://app.threefold.ai/api/tickets \
  -H "Authorization: Bearer YOUR_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_address": "456 Oak Avenue, Anytown, CA 90210",
    "ticket_title": "Street light outage",
    "ticket_description": "Street light at corner of Oak and Main has been out for 3 days",
    "ticket_type_id": 3,
    "step_id": 15,
    "priority": "medium",
    "custom_fields": {
      "pole_number": "SL-2025-0456",
      "outage_type": "complete",
      "reported_by_resident": true,
      "estimated_repair_date": "2025-01-22",
      "affected_area_radius": 50,
      "hazard_level": "moderate"
    }
  }'
```

### Updating Custom Fields

```bash
curl -X PATCH https://app.threefold.ai/api/tickets/12345 \
  -H "Authorization: Bearer YOUR_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "custom_fields": {
      "repair_completed": true,
      "actual_repair_date": "2025-01-21",
      "repair_cost": 450.00,
      "repair_notes": "Replaced ballast and bulb"
    }
  }'
```

### Querying Tickets by Custom Fields

```bash
curl -X GET "https://app.threefold.ai/api/tickets?custom_fields=%7B%22hazard_level%22%3A%22high%22%2C%22repair_completed%22%3Afalse%7D" \
  -H "Authorization: Bearer YOUR_MCP_TOKEN"
```

(URL-decoded: `custom_fields={"hazard_level":"high","repair_completed":false}`)

---

## Support

For integration support:
- Email: support@threefold.ai
- Documentation: https://docs.threefold.ai
- API Status: https://status.threefold.ai
