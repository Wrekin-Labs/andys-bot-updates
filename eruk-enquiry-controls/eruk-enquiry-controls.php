<?php
/**
 * Plugin Name: ERUK Repair Desk Enquiry Controls
 * Description: Adds safe delete controls for closed Electronic Repairs UK website enquiries.
 * Version: 1.0.0
 * Author: Wrekin Labs
 */
if (!defined('ABSPATH')) exit;

function eruk_enquiry_controls_inject($html) {
    if (strpos($html, 'id="enquiries"') === false || strpos($html, 'id="eruk-enquiry-delete-controls"') !== false) return $html;
    $script = <<<'HTML'
<script id="eruk-enquiry-delete-controls" type="module">
import {sb,toast} from '/wp-content/plugins/electronic-repairs-site/assets/js/core.js';
let canDelete=false;
async function checkAccess(){
  try{
    const {data:{user}}=await sb.auth.getUser();
    if(!user)return false;
    const {data,error}=await sb.from('era_shop_members').select('full_access,active').eq('user_id',user.id).eq('active',true).maybeSingle();
    return !error && Boolean(data?.full_access);
  }catch{return false}
}
function reloadEnquiries(){document.getElementById('reloadEnquiries')?.click()}
async function deleteEnquiry(id,button){
  if(!id||!confirm('Permanently delete this closed enquiry? This cannot be undone.'))return;
  const old=button.textContent; button.disabled=true; button.textContent='Deleting…';
  try{
    const {data,error}=await sb.rpc('era_delete_public_enquiry',{p_id:id});
    if(error)throw error;
    if(!data)throw new Error('Enquiry was not found or was already deleted.');
    toast('Enquiry deleted.'); reloadEnquiries();
  }catch(e){toast(e?.message||'Could not delete enquiry.')}
  finally{button.disabled=false;button.textContent=old}
}
async function clearTests(button){
  if(!confirm('Delete all closed test enquiries? Genuine customer enquiries will not be touched.'))return;
  const old=button.textContent; button.disabled=true; button.textContent='Clearing…';
  try{
    const {data,error}=await sb.rpc('era_clear_closed_test_enquiries');
    if(error)throw error;
    const n=Number(data||0);
    toast(n?n+' test enquir'+(n===1?'y':'ies')+' deleted.':'No closed test enquiries found.');
    reloadEnquiries();
  }catch(e){toast(e?.message||'Could not clear test enquiries.')}
  finally{button.disabled=false;button.textContent=old}
}
function addControls(){
  if(!canDelete)return;
  const refresh=document.getElementById('reloadEnquiries');
  if(refresh&&!document.getElementById('clearTestEnquiries')){
    const b=document.createElement('button'); b.id='clearTestEnquiries'; b.type='button'; b.className='btn danger'; b.textContent='Clear test enquiries'; b.onclick=()=>clearTests(b); refresh.insertAdjacentElement('afterend',b);
  }
  const box=document.getElementById('enquiries'); if(!box)return;
  box.querySelectorAll('article.card').forEach(card=>{
    const status=card.querySelector('[data-enquiry-status]');
    if(!status||status.dataset.next!=='new'||card.querySelector('[data-delete-enquiry]'))return;
    const actions=status.closest('.actions'); if(!actions)return;
    const b=document.createElement('button'); b.type='button'; b.className='btn danger'; b.dataset.deleteEnquiry=status.dataset.enquiryStatus; b.textContent='Delete'; b.onclick=()=>deleteEnquiry(status.dataset.enquiryStatus,b); actions.appendChild(b);
  });
}
(async()=>{
  canDelete=await checkAccess(); if(!canDelete)return;
  addControls();
  const target=document.getElementById('view-enquiries')||document.body;
  new MutationObserver(addControls).observe(target,{childList:true,subtree:true});
})();
</script>
HTML;
    return str_replace('</body>', $script . '</body>', $html);
}

function eruk_enquiry_controls_start_buffer() {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if ($path === '/admin.html' && ob_get_level() >= 0) {
        ob_start('eruk_enquiry_controls_inject');
    }
}
add_action('plugins_loaded', 'eruk_enquiry_controls_start_buffer', -1000000);

