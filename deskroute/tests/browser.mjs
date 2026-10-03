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
await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});const base='http://127.0.0.1:'+server.address().port;
let browser;const checks=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.DESKROUTE_CHROMIUM_PATH?{executablePath:process.env.DESKROUTE_CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const titles={inbox:'Inbox',human:'Human Queue',brain:'Business Brain',automations:'Automations',analytics:'Analytics',channels:'Channels',help:'Help Centre',team:'Team',settings:'Settings',alerts:'Notifications',review:'Review Queue',autosetup:'AutoSetup',brands:'Brands',billing:'Billing',audit:'Audit'};
 const go=async route=>{await page.goto(base+'/qa/#'+route);await page.waitForFunction(title=>document.querySelector('#pageTitle')?.textContent===title&&!document.querySelector('#content')?.textContent.includes('Loading…'),titles[route]);assert.equal(await page.getByText('This page could not load',{exact:true}).count(),0,route);};
 await page.goto(base+'/qa/');await page.locator('.ticket-row').first().waitFor();checks.push('Demo workspace loads');
 await page.getByRole('button',{name:'Open conversation with Alex Morgan',exact:true}).click();await page.locator('#replyText').waitFor();
 await page.locator('#replyText').fill('Draft must stay when marking pending.');await page.getByRole('button',{name:'Mark pending',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ticketStatus')?.value==='pending');
 assert.equal(await page.locator('#replyText').inputValue(),'Draft must stay when marking pending.');assert.equal(await page.locator('.bubble').filter({hasText:'Draft must stay when marking pending.'}).count(),0);checks.push('Status change does not send reply or lose draft');
 await page.getByRole('button',{name:'Send reply',exact:true}).click();await page.locator('.bubble').filter({hasText:'Draft must stay when marking pending.'}).waitFor();assert.equal(await page.locator('.bubble').filter({hasText:'Draft must stay when marking pending.'}).count(),1);checks.push('Public reply saved once in synthetic conversation');
 await page.getByRole('tab',{name:'Internal Note',exact:true}).click();await page.locator('#replyText').fill('Private review for our team.');await page.locator('#mentionUser').selectOption('e6100000-0000-4000-8000-000000000002');await page.getByRole('button',{name:'Add note',exact:true}).click();await page.locator('.message.internal').filter({hasText:'Private review for our team.'}).waitFor();checks.push('Internal note and teammate selection');
 const bodies=await page.locator('.bubble').allTextContents();assert.match(bodies[0],/Can we arrange a booking/);assert.equal(bodies.at(-1),'Private review for our team.');checks.push('Conversation chronology');
 assert.deepEqual(await page.locator('#nav img').evaluateAll(images=>images.filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src)),[]);checks.push('Navigation images load');
 await page.locator('#replyText').fill('Keep this private draft while messages arrive.');await page.locator('#replyText').focus();
 await page.evaluate(async()=>{const demo=await import('./api.js');demo.injectDemoMessage('A new customer message arrived.');window.dispatchEvent(new Event('focus'));});
 await page.locator('.bubble').filter({hasText:'A new customer message arrived.'}).waitFor();assert.equal(await page.locator('#replyText').inputValue(),'Keep this private draft while messages arrive.');assert.equal(await page.locator('#replyText').evaluate(el=>document.activeElement===el),true);checks.push('Incoming refresh preserves draft and keyboard focus');
 await page.locator('#replyText').fill('');
 await page.locator('#toast').waitFor({state:'hidden'});await page.screenshot({path:output+'/01-desktop-inbox.png',fullPage:true});
 for(const route of ['human','brain','automations','analytics','channels','help','team','settings','alerts','review','autosetup','brands','billing','audit']){
  await go(route);checks.push('Page: '+route);
 }
 await page.goto(base+'/qa/#brain');await page.getByText('Cancellation policy',{exact:true}).click();await page.getByRole('button',{name:'Approve',exact:true}).click();await page.locator('.fact-item').filter({hasText:'Cancellation policy'}).getByText('Approved',{exact:true}).waitFor();checks.push('Fact review and approval');
 await page.getByRole('button',{name:'Add fact',exact:true}).click();await page.locator('#factKey').fill('Contact details');await page.locator('#factValue').fill('Please contact team@example.com.');await page.getByRole('button',{name:'Save for review',exact:true}).click();await page.getByText('Contact details',{exact:true}).waitFor();checks.push('New fact saved pending review');
 await page.goto(base+'/qa/#help');await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByRole('button',{name:'Unpublish',exact:true}).waitFor();await page.getByRole('button',{name:'Enable public centre',exact:true}).click();await page.getByRole('link',{name:'Open public centre ↗'}).waitFor();checks.push('Article publication and centre enabled');
 await go('automations');await page.getByRole('button',{name:'New automation',exact:true}).click();await page.locator('#ruleName').fill('Route urgent questions');await page.locator('#ruleContains').fill('urgent');await page.locator('#rulePriority').selectOption('urgent');await page.getByRole('button',{name:'Save rule',exact:true}).click();const rule=page.locator('.rule').filter({hasText:'Route urgent questions'});await rule.getByRole('button',{name:'Off',exact:true}).waitFor();await rule.getByRole('button',{name:'Off',exact:true}).click();await rule.getByRole('button',{name:'On',exact:true}).waitFor();checks.push('Automation saves disabled and can be enabled');
 await go('alerts');await page.getByRole('button',{name:'Mark read',exact:true}).click();await page.getByText('Read',{exact:true}).waitFor();await page.getByRole('button',{name:'Open conversation',exact:true}).click();await page.locator('#replyText').waitFor();checks.push('Notification read and conversation navigation');
 await go('settings');await page.locator('#pref-new_message').check();await page.getByRole('button',{name:'Save preferences',exact:true}).click();await page.getByText('Notification preferences saved.',{exact:true}).waitFor();checks.push('Notification preferences save');
 await go('autosetup');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Scan website',exact:true}).click();await page.getByText('Scanned demo fact',{exact:true}).waitFor();await page.locator('.fact-item').filter({hasText:'Scanned demo fact'}).getByText('Pending',{exact:true}).waitFor();checks.push('Synthetic scan proposals require review');
 await go('inbox');await page.getByRole('button',{name:'Open conversation with Taylor Green',exact:true}).click();await page.locator('#sendReply').waitFor();await page.getByRole('tab',{name:'Public Reply',exact:true}).click();assert.equal(await page.locator('#sendReply').isEnabled(),false);await page.getByRole('tab',{name:'Internal Note',exact:true}).click();assert.equal(await page.locator('#sendReply').isEnabled(),true);checks.push('Unsupported channel blocks public reply but permits internal note');
 for(const width of [1440,1024,768,390,360]){
  await page.setViewportSize({width,height:900});for(const route of ['human','inbox','brain','analytics','settings']){
   await go(route);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`Horizontal overflow ${route} at ${width}`);
  }checks.push('Responsive pages at '+width+'px');
 }
 await go('human');await page.locator('#toast').waitFor({state:'hidden'});await page.screenshot({path:output+'/02-mobile-human-queue.png',fullPage:true});
 await page.locator('#menuButton').click();await page.locator('#sidebar.open').waitFor();await page.keyboard.press('Escape');await page.locator('#sidebar.open').waitFor({state:'hidden'});checks.push('Mobile menu opens and Escape closes it');
 await page.locator('.human-card').click();await page.locator('#replyText').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.getByRole('button',{name:'← Inbox',exact:true}).click();await page.locator('.ticket-list').waitFor();checks.push('Mobile human queue to conversation and back');
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/site/');await page.getByRole('heading',{name:'Clear answers. A calmer inbox.'}).waitFor();await page.screenshot({path:output+'/03-website-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/04-website-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks.push('Website desktop/mobile');
 await page.goto(base+'/site/docs/');await page.getByRole('heading',{name:'Your first successful handoff'}).waitFor();checks.push('Documentation accessible');
 let widgetMessages=[];
 await context.route('**/qa/widget-api*',async route=>{
  if(route.request().method()==='POST'){const body=route.request().postDataJSON();widgetMessages=[{direction:'inbound',author_type:'customer',body:body.message,created_at:new Date().toISOString()},{direction:'outbound',author_type:'ai',body:'This is the synthetic widget answer.',created_at:new Date().toISOString()}];await route.fulfill({json:{conversationId:'synthetic-widget-conversation',answer:widgetMessages[1].body,needsHuman:false}});}
  else await route.fulfill({json:{display_name:'DeskRoute · Widget test',welcome_message:'Synthetic test only. No live messages.',require_name:false,require_email:false}});
 });
 await context.route('**/qa/widget-sync',route=>route.fulfill({json:{messages:route.request().postDataJSON().after?[]:widgetMessages}}));
 for(const width of [1440,390,360]){
  await page.setViewportSize({width,height:844});await page.goto(base+'/qa/widget.html');await page.getByRole('button',{name:'Open support chat'}).click();await page.getByText('Synthetic test only. No live messages.',{exact:true}).waitFor();
  const box=await page.getByRole('dialog',{name:'Support chat'}).boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=844,`Widget fits ${width}px viewport`);
  await page.getByRole('textbox',{name:'How can we help?',exact:true}).fill('Synthetic opening hours question');await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#deskroute-widget-host')?.shadowRoot?.querySelector('.dr-send')?.disabled===false);await page.getByText('This is the synthetic widget answer.',{exact:true}).waitFor();
  if(width===390)await page.screenshot({path:output+'/06-widget-mobile.png',fullPage:true});
  await page.getByRole('textbox',{name:'How can we help?',exact:true}).press('Escape');await page.getByRole('dialog',{name:'Support chat'}).waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Open support chat'}).evaluate(el=>el.getRootNode().activeElement===el),true);
  await page.getByRole('button',{name:'Open support chat'}).click();await page.getByText('This is the synthetic widget answer.',{exact:true}).waitFor();checks.push(`Widget opens, sends, receives, fits and restores focus at ${width}px`);
 }
 assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'../browser-results.json'),JSON.stringify({time:new Date().toISOString(),scope:'Synthetic preview only; no live delivery/auth assertion',checks},null,2));console.log('PASS: '+checks.length+' browser checks');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
