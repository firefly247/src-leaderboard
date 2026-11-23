(() => {
  'use strict';
  const key='operationsPost';
  const valid=id=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id);
  window.ClubOperationsLink={
    read(){
      if(location.hash&&location.hash!=='#operations')return null;
      const id=new URLSearchParams(location.search).get(key);
      return valid(id)?id:null;
    },
    url(id,base=location.href){
      const url=new URL('./',base);
      url.searchParams.set(key,id);
      return url.href;
    },
    clear(){
      const url=new URL(location.href);
      if(url.searchParams.has(key)){
        url.searchParams.delete(key);
        history.replaceState(history.state,'',url);
      }
    },
    remember(){
      try{
        const id=this.read();
        if(id)sessionStorage.setItem(key,id);
        else sessionStorage.removeItem(key);
      }catch{}
    },
    take(){
      try{
        const id=sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        return valid(id)?id:null;
      }catch{return null;}
    },
  };
})();
