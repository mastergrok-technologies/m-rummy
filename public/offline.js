/** Recovery navigation only. No API calls, moves, credentials or hand caching. */
export function recoveryPath(search) {
  const room=new URLSearchParams(search).get('room')||'';
  return /^[a-f0-9]{12}$/i.test(room)?`/?room=${room.toUpperCase()}`:'/';
}
if(typeof document!=='undefined') {
  const link=document.querySelector('#offline-return'),status=document.querySelector('#offline-status');
  link.href=recoveryPath(location.search);
  function update() {
    status.textContent=navigator.onLine?'Your device reports a network connection. Try returning to the game to check the server.':'Your device reports no network connection. Connect to Wi-Fi or mobile data, then try again.';
  }
  addEventListener('online',update);addEventListener('offline',update);update();
}
