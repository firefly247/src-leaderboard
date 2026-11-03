/* Push only: no fetch interception or offline cache of member/admin data. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  event.waitUntil(self.registration.showNotification('삼성조정클럽 관리자 알림',{
    body:'새 알림이 도착했습니다. 눌러서 사이트에서 확인해 주세요.',
    icon:new URL('static/icons/club-192.png',self.registration.scope).href,
    tag:'club-admin-notification',
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
