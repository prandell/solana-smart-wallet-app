import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';

const url = 'http://localhost:8787/trpc';

export const client = createTRPCProxyClient({
  links: [httpBatchLink({ url })],
});
