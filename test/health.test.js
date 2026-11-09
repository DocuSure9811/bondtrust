import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('GET /health responde ok', async () => {
  const server = createApp().listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', service: 'bondtrust' });
  } finally {
    server.close();
  }
});
