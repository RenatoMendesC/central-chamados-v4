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

      html=html
        .replace(/<link[^>]+href=["']\/assets\/theme-orange\.css[^"']*["'][^>]*>/gi,'')
        .replace(/<link[^>]+href=["']\/assets\/layout-pro\.css[^"']*["'][^>]*>/gi,'');
      html=html.replace('</head>','<link rel="stylesheet" href="/assets/layout-pro.css?v=2"><link rel="stylesheet" href="/assets/theme-orange.css?v=8"></head>');

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
