'use strict';
const {app}=require('electron');
app.setPath('userData',process.argv[2]);
const acquired=app.requestSingleInstanceLock();
if(acquired) app.releaseSingleInstanceLock();
app.exit(acquired?2:0);
