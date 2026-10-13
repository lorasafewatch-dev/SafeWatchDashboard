# SafeWatch Barangay Dashboard

Use Node.js 24, run `npm ci`, copy `.env.example` to `.env` and supply the public
Supabase key, then run `npm run dev`. Local URL: `http://localhost:5174`.
Build with `npm run build`; output is `dist`.

Keep `../shared` with this app. For Vercel's app Root Directory, enable source
files outside the root. See [deployment instructions](../../docs/VERCEL_DEPLOYMENT.md).
Accounts, password recovery and monitoring use the existing Supabase database
and its additive account-access migrations.
