/** Extract an invite locally; never fetch a pasted URL or read a password from it. */
export function inviteCode(value, origin) {
  const text=String(value||'').trim();
  if (/^[a-f0-9]{12}$/i.test(text)) return text.toUpperCase();
  try {
    const url=new URL(text);
    if (!['http:','https:'].includes(url.protocol)||url.origin!==origin||url.pathname!=='/'||url.username||url.password) return '';
    const code=url.searchParams.get('room')||'';
    return /^[a-f0-9]{12}$/i.test(code)?code.toUpperCase():'';
  } catch { return ''; }
}
