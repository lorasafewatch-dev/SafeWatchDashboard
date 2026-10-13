// Runs in Vite's build configuration, never in the browser bundle.
export function validateDeploymentEnv(env) {
  const url=env.VITE_SUPABASE_URL?.trim();
  const key=env.VITE_SUPABASE_ANON_KEY?.trim();
  if(!url||!key||/your[_-]?project|your[_-]?anon[_-]?key/i.test(`${url} ${key}`)) {
    throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in this Vercel project before building. Use .env for local builds.');
  }
  let parsed;
  try{parsed=new URL(url);}catch{throw new Error('VITE_SUPABASE_URL must be a valid HTTPS Supabase project URL.');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/') {
    throw new Error('VITE_SUPABASE_URL must be the HTTPS project URL, without a path, credentials, query or fragment.');
  }
  let publicKey=key.startsWith('sb_publishable_');
  if(!publicKey){
    try{publicKey=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon';}catch{/* Report only the variable name, never the supplied key. */}
  }
  if(!publicKey)throw new Error('VITE_SUPABASE_ANON_KEY must be a public anon or publishable key. Secret and service-role keys cannot be used in a browser app.');
}
