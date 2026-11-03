// Bound read-only startup requests so an unavailable service cannot leave the
// interface on a loading screen forever. Callers still verify every response.
export async function withRequestTimeout(request, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
