import {RecoveryAPI, recoveryToken, LINK_ERROR} from './recovery-api.js';
const api = new RecoveryAPI();
const $ = selector => document.querySelector(selector);
const requestForm = $('#requestForm'), passwordForm = $('#passwordForm'), status = $('#recoveryStatus');
let busy = false, requestedAt = 0;
function message(text, error = false) { status.textContent = text; status.className = 'notice' + (error ? ' danger' : ''); }
function resetFields() { $('#newPassword').value = ''; $('#confirmPassword').value = ''; }
function setBusy(value) { busy=value; document.querySelectorAll('button[type="submit"]').forEach(button => button.disabled=value); }
requestForm.onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  if (Date.now()-requestedAt < 60000) { message('Please wait a minute before requesting another link.'); return; }
  setBusy(true);
  try {
    const text=await api.requestReset($('#recoveryEmail').value, new URL('./password.html', location.href).href);
    requestedAt=Date.now(); message(text);
  } catch (error) { message(error.message,true); }
  finally { setBusy(false); }
};
passwordForm.onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  if ($('#newPassword').value !== $('#confirmPassword').value) { message('The passwords do not match. Enter them again.',true); resetFields(); $('#newPassword').focus(); return; }
  setBusy(true);
  try {
    const result=await api.setPassword($('#newPassword').value);
    localStorage.removeItem('drs');
    passwordForm.classList.add('hidden');
    message('Password updated. You can now return to sign in on your desktop or phone.' + (result.signedOut ? '' : ' Closing this recovery session could not be confirmed; close this tab when finished.'));
  } catch (error) {
    if ([401,403].includes(error.status)) { api.clear(); passwordForm.classList.add('hidden'); requestForm.classList.remove('hidden'); message(LINK_ERROR,true); }
    else message(error.message,true);
  } finally { resetFields(); setBusy(false); }
};
async function openRecovery() {
  const hash=location.hash;
  if (!hash) return;
  // Strip credentials before displaying the form or making an API request.
  history.replaceState(null,'',location.pathname);
  api.clear(); resetFields(); passwordForm.classList.add('hidden');
  requestForm.classList.add('hidden'); setBusy(true); message('Checking your recovery link…');
  try {
    const token=recoveryToken(hash), email=await api.acceptToken(token);
    $('#accountEmail').textContent=email; passwordForm.classList.remove('hidden'); status.classList.add('hidden'); $('#newPassword').focus();
  } catch { api.clear(); requestForm.classList.remove('hidden'); message(LINK_ERROR,true); }
  finally { setBusy(false); }
}
window.addEventListener('pagehide',()=>{api.clear();resetFields();});
window.addEventListener('pageshow',event=>{if(event.persisted){passwordForm.classList.add('hidden');requestForm.classList.remove('hidden');message('Request a fresh recovery link to continue.');}});
window.addEventListener('hashchange',openRecovery);
openRecovery();
