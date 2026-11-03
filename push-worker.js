/* Push only: no fetch interception or offline cache of member/admin data. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json()||{};}catch{}
  const title=typeof payload.title==='string'?payload.title.slice(0,80):'삼성조정클럽 관리자 알림';
  const body=typeof payload.body==='string'?payload.body.slice(0,500):'새 알림이 도착했습니다. 눌러서 사이트에서 확인해 주세요.';
  event.waitUntil(self.registration.showNotification(title,{
    body,
    icon:new URL('static/icons/club-192.png',self.registration.scope).href,
    tag:typeof payload.tag==='string'?payload.tag.slice(0,120):'club-admin-notification',
    data:{url:new URL('#admin',self.registration.scope).href}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL('#admin',self.registration.scope).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
    if(existing){await existing.navigate(target);return existing.focus();}
    return self.clients.openWindow(target);
  })());
});
