export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function escapeAttr(s) { return escapeHtml(s); }

export function timeAgo(date) {
  const sec = Math.round((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'à l\'instant';
  if (sec < 3600) return `il y a ${Math.round(sec/60)} min`;
  if (sec < 86400) return `il y a ${Math.round(sec/3600)} h`;
  return `il y a ${Math.round(sec/86400)} j`;
}
