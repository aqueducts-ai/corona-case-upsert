function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Server
  port: parseInt(optionalEnv('PORT', '3000'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  // Railway Postgres (state storage)
  databaseUrl: requireEnv('DATABASE_URL'),

  // Threefold API
  threefoldApiUrl: requireEnv('THREEFOLD_API_URL'),
  threefoldApiToken: requireEnv('THREEFOLD_API_TOKEN'),
  threefoldOrgId: requireEnv('THREEFOLD_ORG_ID'),

  // Case updates - set to 'false' to disable Threefold ticket custom field updates (dry run mode)
  // When disabled: still does DB upserts and logs changes, but skips ticket custom field API calls
  caseUpdatesEnabled: optionalEnv('CASE_UPDATES_ENABLED', 'true') === 'true',
} as const;
