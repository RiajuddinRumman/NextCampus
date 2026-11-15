// Ad-hoc smoke test: register -> verify -> sign in -> create listing -> search.
const BASE = process.env.BASE || 'http://localhost:3210/api';

let cookie = '';
const jar = () => (cookie ? { cookie } : {});
const collect = (res) => {
  const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  set.forEach((c) => {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    cookie = cookie.replace(new RegExp(`${k}=[^;]*;?`), '') + `${k}=${v}; `;
  });
};

const call = async (method, path, body, extraHeaders = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...jar(), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  collect(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 200);
  }
  return { status: res.status, json };
};

const email = `smoke.${Date.now()}@lmu.edu`;
const password = 'SuperSecret123';

const step = (name, r) => {
  console.log(`${name}: ${r.status}`);
  if (r.status >= 400) console.dir(r.json, { depth: 4 });
  return r.json?.data ?? r.json;
};

const signUp = step(
  'sign-up',
  await call('POST', '/auth/sign-up', {
    email,
    password,
    name: 'Smoke Tester',
    department: 'CSE',
    academicLevel: 'UNDERGRADUATE',
  }),
);

const { readFileSync } = await import('node:fs');
const log = readFileSync('/tmp/scsp-boot.log', 'utf8');
const token = [...log.matchAll(/verify-email\?token=([^&\s]+)/g)].pop()?.[1];
if (!token) throw new Error('No verification token found in the mail log');

step('verify-email', await call('POST', '/auth/verify-email', { token }));
step(
  'sign-in',
  await call('POST', '/auth/sign-in', {
    email,
    password,
    sessionOnly: false,
  }),
);
const me = step('me', await call('GET', '/auth/me'));
console.log('  persisted:', JSON.stringify({ dept: me?.user?.department, lvl: me?.user?.academicLevel, inst: me?.user?.institution, verified: me?.user?.emailVerified }));

step(
  'create listing',
  await call('POST', '/listings', {
    category: 'MARKETPLACE',
    title: 'Scientific calculator (Casio fx-991)',
    description: 'Barely used, available for pickup at the library.',
    price: 1800,
    currency: 'BDT',
    locationText: 'Dhanmondi',
    data: { intent: 'SELL', condition: 'LIKE_NEW' },
  }),
);
const search = step('search', await call('GET', '/listings?category=MARKETPLACE&q=calculator'));
console.log('  results:', search?.meta?.total ?? search?.total ?? JSON.stringify(search).slice(0, 120));

const denied = await call('GET', '/admin/overview');
console.log(`admin as student (expect 403): ${denied.status}`);
const anon = await call('GET', '/inquiries/received');
console.log(`anonymous inquiries (expect 401): ${anon.status}`);
console.log('signUp user id:', signUp?.user?.id);
