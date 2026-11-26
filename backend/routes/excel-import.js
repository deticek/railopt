const express=require('express');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

function createExcelImportRouter({requireSession,requireAdmin,asyncRoute}){
  const router=express.Router();
  router.post('/api/imports/excel',requireSession,requireAdmin,express.raw({type:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'],limit:'25mb'}),asyncRoute(async(req,res)=>{
    const data=req.body;
    if(!Buffer.isBuffer(data)||data.length<4||data.readUInt32LE(0)!==0x04034b50)return res.status(400).json({error:'Izberi veljavno datoteko Excel (.xlsx).'});
    const file=path.join(os.tmpdir(),`railopt-excel-import-${require('node:crypto').randomUUID()}.xlsx`);
    try{
      await fs.writeFile(file,data,{flag:'wx'});
      const result=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[path.join(__dirname,'..','import_excel.js'),file],{cwd:path.join(__dirname,'..'),env:process.env,windowsHide:true,stdio:['ignore','pipe','ignore']});
        let output='';child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-12000);});child.once('error',reject);child.once('close',code=>{if(code!==0)return reject(new Error('Excel uvoz ni uspel. Preveri stolpce in povezavo z bazo.'));const lines=output.trim().split(/\r?\n/);try{resolve(JSON.parse(lines.at(-1)||'{}'));}catch{reject(new Error('Excel je bil uvožen, vendar povzetka ni mogoče prebrati.'));}});
      });
      res.json({imported:true,...result});
    }finally{await fs.rm(file,{force:true}).catch(()=>{});}
  }));
  return router;
}
module.exports=createExcelImportRouter;
