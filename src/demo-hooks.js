/* Preload do Modo Demo e tema visual global. */
const expressPath=require.resolve('express');
const originalExpress=require('express');
const fs=require('fs');
const path=require('path');
const {query}=require('./db');
const {setAuthCookie}=require('./auth');
function wrappedExpress(){
  const app=originalExpress();
  /* Entrega o CSS original + somente sobrescritas de cor. Assim todas as telas mantêm layout, fonte e dimensões originais. */
  app.get('/assets/style.css',(req,res)=>{
    try{
      const base=fs.readFileSync(path.join(process.cwd(),'public','style.css'),'utf8');
      const theme=fs.readFileSync(path.join(process.cwd(),'public','theme-orange.css'),'utf8');
      res.type('text/css').set('Cache-Control','no-cache').send(base+'\n\n/* TEMA LARANJA CLARO */\n'+theme);
    }catch(e){console.error('Falha ao carregar tema:',e.message);res.status(500).type('text/css').send('');}
  });
  app.post('/api/auth/demo',async(req,res)=>{
    try{
      if(!process.env.DEMO_PASSWORD)return res.status(503).json({error:'Modo Demo ainda não está habilitado.'});
      const r=await query("SELECT u.*,o.name organization_name,o.status organization_status FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.username='central.demo' AND o.slug='central-demo' AND u.status='active' LIMIT 1");
      const u=r.rows[0];
      if(!u)return res.status(503).json({error:'Ambiente Demo está sendo preparado. Tente novamente em instantes.'});
      setAuthCookie(res,u);
      res.json({ok:true,demo:true});
    }catch(e){console.error('Falha ao abrir Modo Demo:',e.message);res.status(500).json({error:'Não foi possível abrir o Modo Demo.'});}
  });
  return app;
}
Object.assign(wrappedExpress,originalExpress);
require.cache[expressPath].exports=wrappedExpress;
