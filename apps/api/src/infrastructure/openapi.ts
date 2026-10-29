import { OpenAPIObject } from '@nestjs/swagger';
import {
  SchemaObject,
  ReferenceObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
const string: SchemaObject = { type: 'string' };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const money: SchemaObject = {
  type: 'string',
  pattern: '^-?[0-9]+$',
  example: '1234',
  description:
    'Exact integer minor units serialized as a string; 100 = EGP 1.00',
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (
  properties: Record<string, SchemaObject | ReferenceObject>,
  required = Object.keys(properties),
): SchemaObject => ({ type: 'object', properties, required });
export function completeOpenApi(document: OpenAPIObject) {
  const schemas: Record<string, SchemaObject> = {
    Error: object({
      error: object({
        code: string,
        message: { oneOf: [string, { type: 'array', items: string }] },
        requestId: uuid,
      }),
    }),
    Profile: object({
      id: uuid,
      email: { type: 'string', format: 'email' },
      name: string,
      role: { type: 'string', enum: ['USER', 'ADMIN'] },
    }),
    AccessToken: object({ accessToken: string }),
    Ok: object({ ok: { type: 'boolean' } }),
    Wallet: object({
      id: uuid,
      userId: uuid,
      systemKey: { type: 'string', nullable: true },
      currency: { type: 'string', enum: ['EGP'] },
      status: { type: 'string', enum: ['ACTIVE', 'FROZEN'] },
      balance: money,
      createdAt: date,
    }),
    Transfer: object({
      id: uuid,
      sourceId: uuid,
      destinationId: uuid,
      amount: money,
      currency: { type: 'string', enum: ['EGP'] },
      kind: { type: 'string', enum: ['TRANSFER', 'DEMO_FUNDING'] },
      createdAt: date,
    }),
    Posting: object({
      id: uuid,
      journalId: uuid,
      walletId: uuid,
      side: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
      amount: money,
      createdAt: date,
    }),
    Journal: object({
      id: uuid,
      transferId: uuid,
      createdAt: date,
      postings: { type: 'array', items: ref('Posting') },
    }),
    TransferResult: {
      allOf: [
        ref('Transfer'),
        object({
          status: { type: 'string', enum: ['COMPLETED'] },
          journalId: uuid,
        }),
      ],
    },
    TransferDetail: {
      allOf: [
        ref('Transfer'),
        object({
          status: { type: 'string', enum: ['COMPLETED'] },
          journal: ref('Journal'),
        }),
      ],
    },
    History: object({
      items: { type: 'array', items: ref('Transfer') },
      total: { type: 'integer' },
      page: { type: 'integer' },
      limit: { type: 'integer' },
    }),
    Notification: object({
      id: uuid,
      eventId: uuid,
      userId: uuid,
      message: string,
      createdAt: date,
    }),
    Audit: object({
      id: uuid,
      userId: { ...uuid, nullable: true },
      action: string,
      resourceId: string,
      createdAt: date,
    }),
    Job: object({
      id: uuid,
      type: string,
      payload: { type: 'object', additionalProperties: true },
      attempts: { type: 'integer' },
      createdAt: date,
      nextAttemptAt: date,
      publishedAt: { ...date, nullable: true },
      deadAt: { ...date, nullable: true },
      lastError: { type: 'string', nullable: true },
    }),
    Stats: object({
      users: { type: 'integer' },
      wallets: { type: 'integer' },
      transfers: { type: 'integer' },
      pendingEvents: { type: 'integer' },
      metrics: object({
        requests: { type: 'integer' },
        failures: { type: 'integer' },
        totalDurationMs: { type: 'number' },
      }),
    }),
    Live: object({
      status: { type: 'string', enum: ['ok'] },
      simulation: { type: 'boolean', enum: [true] },
    }),
    Ready: object({ status: { type: 'string', enum: ['ready'] } }),
  };
  document.components ??= {};
  document.components.schemas = { ...document.components.schemas, ...schemas };
  const responses: Record<string, string> = {
    '/auth/register': 'AccessToken',
    '/auth/login': 'AccessToken',
    '/auth/refresh': 'AccessToken',
    '/auth/logout': 'Ok',
    '/auth/me': 'Profile',
    '/users/me': 'Profile',
    '/wallets': 'Wallet',
    '/wallets/me': 'Wallet',
    '/wallets/me/transactions': 'History',
    '/transfers': 'TransferResult',
    '/demo/fund': 'TransferResult',
    '/transfers/{id}': 'TransferDetail',
    '/notifications': 'Notification[]',
    '/admin/stats': 'Stats',
    '/admin/jobs/failed': 'Job[]',
    '/admin/audit': 'Audit[]',
    '/health/live': 'Live',
    '/health/ready': 'Ready',
  };
  for (const [path, item] of Object.entries(document.paths)) {
    const name = responses[path.replace('/api/v1', '')];
    if (!name) throw new Error(`OpenAPI response schema missing: ${path}`);
    for (const method of ['get', 'post'] as const) {
      const operation = item[method];
      if (!operation) continue;
      const schema = name.endsWith('[]')
        ? { type: 'array' as const, items: ref(name.slice(0, -2)) }
        : ref(name);
      operation.responses[method === 'post' ? '201' : '200'] = {
        description: 'Successful operation',
        content: { 'application/json': { schema } },
      };
      for (const status of [400, 401, 403, 404, 409, 429, 500, 503])
        operation.responses[status] = {
          description: `HTTP ${status}; see error.message for details`,
          content: { 'application/json': { schema: ref('Error') } },
        };
    }
  }
}
