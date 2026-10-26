import { sha256 } from 'npm:@noble/hashes@1.8.0/sha256';
import { createHandler } from './handler.mjs';

const url=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!key)throw new Error('Required server environment is missing');
Deno.serve(createHandler({url,key,hash:sha256}));
