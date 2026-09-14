const fs=require('fs');
const path=require('path');
const express=require('express');

const originalSendFile=express.response.sendFile;
express.response.sendFile=function(filePath,options,callback){
  const absolute=path.resolve(filePath);
  if(absolute.endsWith('.html')&&absolute.includes(`${path.sep}views${path.sep}`)){
    const cb=typeof options==='function'?options:callback;
    fs.readFile(absolute,'utf8',(err,html)=>{
      if(err){
        if(cb)return cb(err);
        return this.status(500).send('Erro ao carregar a página.');
      }
      if(!html.includes('/assets/theme-orange.css')){
        html=html.replace('</head>','<link rel="stylesheet" href="/assets/theme-orange.css?v=6"></head>');
      }else{
        html=html.replace(/\/assets\/theme-orange\.css\?v=[^"']+/g,'/assets/theme-orange.css?v=6');
      }
      if(!html.includes('/assets/theme-lock.js')){
        html=html.replace('</body>','<script src="/assets/theme-lock.js?v=1"></script></body>');
      }else{
        html=html.replace(/\/assets\/theme-lock\.js\?v=[^"']+/g,'/assets/theme-lock.js?v=1');
      }
      this.type('html').send(html);
      if(cb)cb();
    });
    return this;
  }
  return originalSendFile.call(this,filePath,options,callback);
};
