import { readFileSync } from 'node:fs';

const port = Number(readFileSync(new URL('../data-run/server.port', import.meta.url), 'utf8'));
const base = `http://127.0.0.1:${port}`;
const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const get = (path) => fetch(base + path).then((r) => r.json());

console.log('health:', await get('/api/health'));
const created = await post('/api/analyses', { colors: ['A', 'B', 'C'], slots: 2 });
console.log('created:', created.data);
const id = created.data.id;
console.log(
  'feedback 01 vs 10:',
  await post('/api/feedback', { colors: ['A', 'B', 'C'], slots: 2, guess: [0, 1], answer: [1, 0] }),
);
console.log(
  'append:',
  await post(`/api/analyses/${id}/records`, { guess: [0, 1], feedback: { black: 0, white: 2 } }),
);
console.log('suggestion:', JSON.stringify((await get(`/api/analyses/${id}/suggestion`)).data, null, 1));
console.log('history:', await get(`/api/analyses/${id}/history`));
