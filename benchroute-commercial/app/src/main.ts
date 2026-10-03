import './style.css';

type Repair = {
  id: string;
  customer: string;
  item: string;
  detail: string;
  status: 'Needs diagnosis' | 'Waiting approval' | 'Awaiting parts' | 'In progress' | 'Ready';
  age: string;
  value: string;
  priority?: boolean;
};

const repairs: Repair[] = [
  { id:'BR-1048', customer:'Maya Carter', item:'Marantz PM6007', detail:'Intermittent left channel', status:'Needs diagnosis', age:'2d', value:'£25', priority:true },
  { id:'BR-1047', customer:'Tom Reed', item:'Fender Hot Rod Deluxe', detail:'Harsh output above low volume', status:'Waiting approval', age:'3d', value:'£125' },
  { id:'BR-1044', customer:'Northside Audio', item:'Allen & Heath ZED-14', detail:'Channel 7 preamp noise', status:'Awaiting parts', age:'6d', value:'£182' },
  { id:'BR-1041', customer:'A. Shah', item:'Technics SL-7', detail:'Linear arm not travelling', status:'In progress', age:'7d', value:'£145' },
  { id:'BR-1039', customer:'Hannah Lee', item:'Yamaha HS8', detail:'No power', status:'Ready', age:'8d', value:'£96' }
];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root missing');

app.innerHTML = `
  <div class="shell">
    <aside class="rail" aria-label="Primary navigation">
      <div class="brand">
        <div class="brand-mark">BR</div>
        <div><strong>BenchRoute</strong><span>Workshop OS</span></div>
      </div>
      <nav>
        <button class="nav-item active" data-view="repairs"><span>Repairs</span><b>18</b></button>
        <button class="nav-item" data-view="tasks"><span>Tonight / Tasks</span><b>4</b></button>
        <button class="nav-item" data-view="new"><span>New repair</span></button>
        <button class="nav-item" data-view="customers"><span>Customers</span></button>
        <button class="nav-item" data-view="enquiries"><span>Enquiries</span><b>3</b></button>
        <button class="nav-item" data-view="parts"><span>Parts / Stock</span></button>
        <button class="nav-item" data-view="billing"><span>Quotes & Invoices</span></button>
      </nav>
      <div class="rail-foot">
        <span class="plan-pill">Workshop trial · 11 days left</span>
        <button class="ghost-btn" id="settingsBtn">Shop settings</button>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">Saturday · Demo workshop</p>
          <h1>What needs attention?</h1>
        </div>
        <div class="top-actions">
          <button class="ghost-btn" id="searchBtn">Search</button>
          <button class="primary-btn" id="newRepairBtn">+ New repair</button>
        </div>
      </header>

      <section class="metrics" aria-label="Workshop summary">
        <article><span>On bench</span><strong>18</strong><small>5 need attention</small></article>
        <article><span>Waiting on customer</span><strong>4</strong><small>£487 quoted</small></article>
        <article><span>Ready to collect</span><strong>6</strong><small>£642 outstanding</small></article>
        <article><span>Parts delayed</span><strong>3</strong><small>oldest 6 days</small></article>
      </section>

      <section class="workspace">
        <div class="workspace-head">
          <div>
            <h2>Repair queue</h2>
            <p>Bench-first view: diagnosis, approvals, parts and collection.</p>
          </div>
          <div class="filters" role="group" aria-label="Repair filter">
            <button class="filter active" data-filter="All">All</button>
            <button class="filter" data-filter="Needs diagnosis">Diagnosis</button>
            <button class="filter" data-filter="Waiting approval">Approval</button>
            <button class="filter" data-filter="Awaiting parts">Parts</button>
            <button class="filter" data-filter="Ready">Ready</button>
          </div>
        </div>
        <div class="repair-list" id="repairList"></div>
      </section>

      <section class="lower-grid">
        <article class="panel">
          <div class="panel-head"><div><span class="eyebrow">Customer decisions</span><h3>2 quotes need chasing</h3></div><span class="badge warn">£305</span></div>
          <p>Keep approvals out of the technician's head. BenchRoute surfaces anything blocking progress.</p>
          <button class="text-btn">Open approvals →</button>
        </article>
        <article class="panel">
          <div class="panel-head"><div><span class="eyebrow">AI bench assistant</span><h3>Similar repair found</h3></div><span class="badge">Beta</span></div>
          <p>PM6007 left-channel fault resembles a previous output-relay / protection case. Technician notes stay authoritative.</p>
          <button class="text-btn">View evidence →</button>
        </article>
      </section>
    </main>
  </div>

  <div class="mobile-nav">
    <button class="active">Repairs</button><button>Tonight</button><button id="mobileNew">New</button><button>Enquiries</button><button>More</button>
  </div>

  <dialog id="quickDialog">
    <form method="dialog">
      <div class="dialog-head"><div><span class="eyebrow">Quick intake</span><h2>New repair</h2></div><button value="cancel" class="icon-btn" aria-label="Close">×</button></div>
      <label>Customer<input placeholder="Search or add customer" /></label>
      <div class="two"><label>Equipment<input placeholder="e.g. amplifier" /></label><label>Make / model<input placeholder="e.g. Marantz PM6007" /></label></div>
      <label>Fault<textarea rows="3" placeholder="Customer's description"></textarea></label>
      <div class="two"><label>Diagnostic fee<input value="25.00" inputmode="decimal" /></label><label>Serial / IMEI<input placeholder="Optional" /></label></div>
      <div class="dialog-actions"><button value="cancel" class="ghost-btn">Cancel</button><button value="default" class="primary-btn">Continue to intake</button></div>
    </form>
  </dialog>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

const list = document.querySelector<HTMLDivElement>('#repairList');
const toast = document.querySelector<HTMLDivElement>('#toast');
const dialog = document.querySelector<HTMLDialogElement>('#quickDialog');

function statusClass(status: Repair['status']) {
  if (status === 'Ready') return 'ready';
  if (status === 'Waiting approval') return 'approval';
  if (status === 'Awaiting parts') return 'parts';
  if (status === 'Needs diagnosis') return 'diagnosis';
  return 'progress';
}

function render(filter = 'All') {
  if (!list) return;
  const visible = filter === 'All' ? repairs : repairs.filter(r => r.status === filter);
  list.innerHTML = visible.map(r => `
    <article class="repair-row">
      <div class="repair-id"><span>${r.id}</span><small>${r.age} old</small></div>
      <div class="repair-main">
        <strong>${r.item}${r.priority ? '<em>Priority</em>' : ''}</strong>
        <span>${r.customer} · ${r.detail}</span>
      </div>
      <div><span class="status ${statusClass(r.status)}">${r.status}</span></div>
      <div class="money"><span>Current value</span><strong>${r.value}</strong></div>
      <button class="open-btn" data-open="${r.id}">Open</button>
    </article>
  `).join('') || '<div class="empty">No repairs in this view.</div>';

  list.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(btn => btn.addEventListener('click', () => {
    showToast(`${btn.dataset.open} would open the full bench record.`);
  }));
}

function showToast(message: string) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2400);
}

document.querySelectorAll<HTMLButtonElement>('.filter').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render(btn.dataset.filter || 'All');
}));

function openNewRepair() {
  if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
}
document.querySelector('#newRepairBtn')?.addEventListener('click', openNewRepair);
document.querySelector('#mobileNew')?.addEventListener('click', openNewRepair);
document.querySelector('#searchBtn')?.addEventListener('click', () => showToast('Global search prototype: customers, serials, jobs and parts.'));
document.querySelector('#settingsBtn')?.addEventListener('click', () => showToast('Commercial settings will hold shop-specific rates, hours, branding and templates.'));
document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  showToast(`${btn.textContent?.trim()} view is queued for the commercial build.`);
}));

render();
