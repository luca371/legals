import { supabase } from './supabase';

// supabase-js's functions.invoke() only gives back a generic "Edge Function
// returned a non-2xx status code" on failure — the actual { error: "..." }
// body our functions return has to be pulled out of error.context (the raw
// Response) by hand, or every caller just shows that generic string.
export async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    if (error.context && typeof error.context.json === 'function') {
      try {
        const parsed = await error.context.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // response body wasn't JSON — keep the generic message
      }
    }
    throw new Error(message || `${name} request failed.`);
  }
  return data;
}
