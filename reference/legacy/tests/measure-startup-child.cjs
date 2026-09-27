'use strict';
const {app,BrowserWindow,dialog}=require('electron');
const path=require('node:path');
app.disableHardwareAcceleration();
app.setPath('userData',process.argv[3]);app.setPath('sessionData',process.argv[3]);
BrowserWindow.prototype.show=function(){};
dialog.showErrorBox=()=>app.exit(2);
app.on('browser-window-created',(_e,win)=>{
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load',async()=>{
    const deadline=Date.now()+8000;
    while(Date.now()<deadline){
      if(await win.webContents.executeJavaScript('!!window.vaultAPI && !!document.querySelector("form")')){process.stdout.write('READY\n');app.exit(0);return;}
      await new Promise(r=>setTimeout(r,20));
    }
    app.exit(3);
  });
});
require(path.join(process.argv[2],'electron/main.cjs'));
