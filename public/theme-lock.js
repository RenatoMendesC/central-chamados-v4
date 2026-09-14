(()=>{
  const root=document.documentElement;
  const colors={
    '--accent':'#c54a00',
    '--accent2':'#a83d00',
    '--accent-soft':'rgba(197,74,0,.10)',
    '--blue':'#c54a00',
    '--info':'#c54a00'
  };
  let applying=false;
  function lockOrangeTheme(){
    if(applying)return;
    applying=true;
    try{
      for(const [name,value] of Object.entries(colors)){
        if(root.style.getPropertyValue(name).trim()!==value||root.style.getPropertyPriority(name)!=='important'){
          root.style.setProperty(name,value,'important');
        }
      }
    }finally{applying=false;}
  }
  lockOrangeTheme();
  const observer=new MutationObserver(lockOrangeTheme);
  observer.observe(root,{attributes:true,attributeFilter:['style']});
  document.addEventListener('DOMContentLoaded',lockOrangeTheme,{once:true});
  window.addEventListener('load',lockOrangeTheme,{once:true});
  setTimeout(lockOrangeTheme,0);
  setTimeout(lockOrangeTheme,250);
  setTimeout(lockOrangeTheme,1000);
})();
