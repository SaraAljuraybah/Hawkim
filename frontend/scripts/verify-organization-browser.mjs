// Actual Chrome + actual Vite frontend against the isolated local Supabase project.
// Uses built-in CDP/WebSocket, no browser or test dependency added to the application.
import {spawn} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=new URL('../../',import.meta.url)
const fixture=JSON.parse(readFileSync(new URL('.local-tests/browser-fixture.local.json',root),'utf8'))
assert.equal(fixture.url,'http://127.0.0.1:55431','Browser tests require the isolated local backend')
const output=new URL('docs/verification/browser/',root);mkdirSync(output,{recursive:true})
const profile=fileURLToPath(new URL('.local-tests/chrome-'+Date.now(),root));mkdirSync(profile,{recursive:true})
const origin='http://127.0.0.1:5177'
const vite=spawn(process.execPath,[fileURLToPath(new URL('frontend/node_modules/vite/bin/vite.js',root)),'--host','127.0.0.1','--port','5177','--strictPort'],{
 cwd:fileURLToPath(new URL('frontend/',root)),windowsHide:true,stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:fixture.url,VITE_SUPABASE_PUBLISHABLE_KEY:fixture.key},
})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let chrome,socket
const pending=new Map();let seq=0
const runtimeErrors=[]
async function send(method,params={}) {const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method))},25000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result?.value}
async function waitFor(expression){for(let n=0;n<150;n++){if(await evaluate(expression))return;await pause(100)}throw new Error('Browser condition timed out: '+expression)}
async function screenshot(name){await pause(200);const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(new URL(name+'.png',output),Buffer.from(data,'base64'))}
const styles=`e=>{const s=getComputedStyle(e);return {color:s.color,background:s.backgroundColor,font:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,height:s.height,padding:s.padding,borderRadius:s.borderRadius,border:s.border,shadow:s.boxShadow}}`
try {
 for(let n=0;n<100;n++){try{if((await fetch(origin)).ok)break}catch{};if(n===99)throw new Error('Vite did not start');await pause(200)}
 const binary=process.env.HAWKIM_CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
 chrome=spawn(binary,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'})
 let debuggingPort
 for(let n=0;n<100;n++){if(existsSync(profile+'/DevToolsActivePort')){debuggingPort=readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0];break}await pause(100)}
 if(!debuggingPort)throw new Error('Chrome did not open its isolated debugging endpoint')
 const targets=await (await fetch('http://127.0.0.1:'+debuggingPort+'/json/list')).json()
 socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl)
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
 socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(new Error(message.error.message)):task.resolve(message.result)}}else if(message.method==='Runtime.exceptionThrown')runtimeErrors.push(message.params.exceptionDetails.text)}
 await send('Runtime.enable');await send('Page.enable')
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 const storageKey='sb-'+new URL(fixture.url).hostname.split('.')[0]+'-auth-token'
 let injection=await send('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify(fixture.adminSession))})`})
 await send('Page.navigate',{url:origin+'/admin/divisions-departments'})
 await waitFor(`document.querySelector('table[aria-label="Divisions & Departments"]') && [...document.querySelectorAll('button[aria-expanded]')].some(e=>e.getAttribute('aria-label')?.startsWith('Departments:'))`)
 const results={environment:'isolated local Supabase + actual Chrome',viewport:{width:1440,height:1000},approvedReferencesAvailable:false,checks:[]}
 await screenshot('01-divisions-collapsed')
 results.checks.push({name:'collapsed',passed:await evaluate(`![...document.querySelectorAll('button[aria-expanded]')].some(e=>e.getAttribute('aria-label')?.startsWith('Departments:')&&e.getAttribute('aria-expanded')==='true')`)})
 await evaluate(`document.querySelector('button[aria-controls="children-${fixture.division}"]').click()`)
 await waitFor(`[...document.querySelectorAll('a')].some(e=>e.textContent.includes('Add Department'))`)
 results.buttons=await evaluate(`(()=>{const read=${styles};return {division:read([...document.querySelectorAll('button')].find(e=>e.textContent.includes('Add Division'))),department:read([...document.querySelectorAll('a')].find(e=>e.textContent.includes('Add Department')))}})()`)
 await screenshot('02-division-expanded')
 const previewSelector=`[...document.querySelectorAll('button[aria-label]')].find(e=>e.getAttribute('aria-label').startsWith('Preview Drug Safety'))`
 await evaluate(previewSelector+'.click()')
 await waitFor(`document.querySelector('dialog[open]')`)
 results.preview=await evaluate(`(()=>{const read=${styles};const d=document.querySelector('dialog[open]');return {dialog:read(d),heading:read(d.querySelector('h2')),formPadding:getComputedStyle(d.querySelector('form')).padding,backdrop:getComputedStyle(d,'::backdrop').backgroundColor}})()`)
 await screenshot('03-division-preview')
 await send('Browser.grantPermissions',{origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']})
 await evaluate(`document.querySelector('button[aria-label="Copy email"]').click()`)
 await waitFor(`document.querySelector('dialog[open]').textContent.includes('Copied!')`)
 assert.equal(await evaluate('navigator.clipboard.readText()'),'drugsafety@test.invalid')
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'})
 await waitFor(`!document.querySelector('dialog[open]')`)
 results.checks.push({name:'clipboard and Escape',passed:true})
 await evaluate(`document.querySelector('a[href="/admin/departments/${fixture.employeeDepartment}"]').click()`)
 await waitFor(`document.querySelector('main')?.textContent.includes('Author')&&document.querySelector('main')?.textContent.includes('Reviewer')`)
 await screenshot('04-department-details')
 assert(await evaluate(`[...document.querySelectorAll('th')].some(e=>e.textContent==='Position')`))
 results.checks.push({name:'multiple positions and department details',passed:true})
 await send('Page.navigate',{url:origin+'/admin/organizational-structure'})
 await waitFor(`document.querySelector('h1')?.textContent==='Organizational Structure'`)
 await screenshot('05-existing-organizational-structure')
 // Capture the existing Add Co-authors dialog using another genuine local Auth session.
 await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier})
 injection=await send('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify(fixture.authorSession))})`})
 await send('Page.navigate',{url:origin+'/my-sops/'+fixture.primarySopId})
 await waitFor(`[...document.querySelectorAll('button')].some(e=>/Add Co-authors/i.test(e.textContent))`)
 await evaluate(`[...document.querySelectorAll('button')].find(e=>/Add Co-authors/i.test(e.textContent)).click()`)
 await waitFor(`document.querySelector('dialog[open]')`)
 results.coauthors=await evaluate(`(()=>{const read=${styles};const d=document.querySelector('dialog[open]');return {dialog:read(d),heading:read(d.querySelector('h2')),formPadding:getComputedStyle(d.querySelector('form')).padding,backdrop:getComputedStyle(d,'::backdrop').backgroundColor}})()`)
 await screenshot('06-existing-add-coauthors-reference')
 assert.deepEqual(results.preview.dialog,results.coauthors.dialog)
 assert.equal(results.preview.formPadding,results.coauthors.formPadding)
 assert.equal(results.preview.backdrop,results.coauthors.backdrop)
 results.checks.push({name:'preview uses identical native dialog tokens, spacing, shadow and backdrop',passed:true})
 results.runtimeErrors=runtimeErrors
 assert.equal(runtimeErrors.length,0,'Unexpected browser exceptions')
 writeFileSync(new URL('results.json',output),JSON.stringify(results,null,2)+'\n')
 console.log('PASS actual Chrome: four requested captures, existing UI references, real clipboard, Escape and role badges. Approved-image comparison remains pending.')
} finally {socket?.close();chrome?.kill();vite.kill()}
