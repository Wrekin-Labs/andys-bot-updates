// Uses ONLY the isolated synthetic preview. Run after build_preview.py.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=resolve(import.meta.dirname,'../../deskroute-preview-public');
const output=resolve(import.meta.dirname,'../release/screenshots');await mkdir(output,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');let path=decodeURIComponent(url.pathname);if(path.endsWith('/'))path+='index.html';const file=resolve(root,'.'+path);if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let browser;const checks=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.DESKROUTE_CHROMIUM_PATH?{executablePath:process.env.DESKROUTE_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await page.goto(base+'/qa/');await page.locator('.ticket-row').first().waitFor();checks.push('Demo workspace loads');
 await page.getByRole('button',{name:'Open conversation with Alex Morgan',exact:true}).click();await page.locator('#replyText').waitFor();
 await page.locator('#replyText').fill('Draft must stay when marking pending.');await page.getByRole('button',{name:'Mark pending',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ticketStatus')?.value==='pending');
 assert.equal(await page.locator('#replyText').inputValue(),'Draft must stay when marking pending.');assert.equal(await page.locator('.bubble').filter({hasText:'Draft must stay when marking pending.'}).count(),0);checks.push('Status change does not send reply or lose draft');
 await page.getByRole('button',{name:'Send reply',exact:true}).click();await page.locator('.bubble').filter({hasText:'Draft must stay when marking pending.'}).waitFor();assert.equal(await page.locator('.bubble').filter({hasText:'Draft must stay when marking pending.'}).count(),1);checks.push('Public reply saved once in synthetic conversation');
 await page.getByRole('tab',{name:'Internal Note',exact:true}).click();await page.locator('#replyText').fill('Private review for our team.');await page.locator('#mentionUser').selectOption('e6100000-0000-4000-8000-000000000002');await page.getByRole('button',{name:'Add note',exact:true}).click();await page.locator('.message.internal').filter({hasText:'Private review for our team.'}).waitFor();checks.push('Internal note and teammate selection');
 await page.screenshot({path:output+'/01-desktop-inbox.png',fullPage:true});
 for(const route of ['human','brain','automations','analytics','channels','help','team','settings','alerts','review','autosetup','brands','billing','audit']){
  await page.goto(base+'/qa/#'+route);await page.locator('#content').getByText('Loading…',{exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByText('This page could not load',{exact:true}).count(),0,route);checks.push('Page: '+route);
 }
 await page.goto(base+'/qa/#brain');await page.getByText('Cancellation policy',{exact:true}).click();await page.getByRole('button',{name:'Approve',exact:true}).click();await page.locator('.fact-item').filter({hasText:'Cancellation policy'}).getByText('Approved',{exact:true}).waitFor();checks.push('Fact review and approval');
 await page.getByRole('button',{name:'Add fact',exact:true}).click();await page.locator('#factKey').fill('Contact details');await page.locator('#factValue').fill('Please contact team@example.com.');await page.getByRole('button',{name:'Save for review',exact:true}).click();await page.getByText('Contact details',{exact:true}).waitFor();checks.push('New fact saved pending review');
 await page.goto(base+'/qa/#help');await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByRole('button',{name:'Unpublish',exact:true}).waitFor();await page.getByRole('button',{name:'Enable public centre',exact:true}).click();await page.getByRole('link',{name:'Open public centre ↗'}).waitFor();checks.push('Article publication and centre enabled');
 for(const width of [1440,1024,768,390,360]){
  await page.setViewportSize({width,height:900});for(const route of ['human','inbox','brain','analytics','settings']){
   await page.goto(base+'/qa/#'+route);await page.locator('#content').getByText('Loading…',{exact:true}).waitFor({state:'hidden'});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`Horizontal overflow ${route} at ${width}`);
  }checks.push('Responsive pages at '+width+'px');
 }
 await page.goto(base+'/qa/#human');await page.screenshot({path:output+'/02-mobile-human-queue.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/site/');await page.getByRole('heading',{name:'Clear answers. A calmer inbox.'}).waitFor();await page.screenshot({path:output+'/03-website-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/04-website-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks.push('Website desktop/mobile');
 await page.goto(base+'/site/docs/');await page.getByRole('heading',{name:'Your first successful handoff'}).waitFor();checks.push('Documentation accessible');assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'../browser-results.json'),JSON.stringify({time:new Date().toISOString(),scope:'Synthetic preview only; no live delivery/auth assertion',checks},null,2));console.log('PASS: '+checks.length+' browser checks');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
