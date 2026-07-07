(function(){
  const API_BASE = '/.netlify/functions';
  let latestDashboard = null;

  function $(selector, root = document) { return root.querySelector(selector); }
  function $$(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
  }
  function moneyNumber(value) {
    if (typeof value === 'number') return value;
    const n = Number(String(value || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  function formatMoney(value) {
    return '$' + Math.round(moneyNumber(value)).toLocaleString('en-US');
  }
  function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  }
  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function todayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function ensureStatusBar() {
    let el = $('#live-status');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'live-status';
    el.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;background:#101826;color:#fff;border-radius:10px;padding:10px 13px;font-size:12px;box-shadow:0 8px 26px rgba(0,0,0,.18);max-width:360px;display:flex;gap:8px;align-items:center;';
    el.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#B9791A;display:inline-block;"></span><span>Connecting to GHL...</span>';
    document.body.appendChild(el);
    return el;
  }
  function setStatus(type, text) {
    const el = ensureStatusBar();
    const color = type === 'ok' ? '#1C9B6B' : type === 'error' ? '#D8433D' : '#B9791A';
    el.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex:none;"></span><span>${escapeHtml(text)}</span>`;
  }

  function updateBrand(data) {
    const strong = $('.brand-name strong');
    const span = $('.brand-name span');
    if (strong && data.companyName) strong.textContent = data.companyName;
    if (span && data.divisionName) span.textContent = data.divisionName;
  }

  function updateStat(labelMatch, value, deltaText) {
    const card = $$('.stat-card').find(card => ($('.stat-label', card)?.textContent || '').toLowerCase().includes(labelMatch.toLowerCase()));
    if (!card) return;
    const val = $('.stat-value', card);
    if (val) val.textContent = value;
    const delta = $('.stat-delta', card);
    if (delta && deltaText) delta.innerHTML = deltaText;
  }

  function renderStats(data) {
    const s = data.stats || {};
    updateStat('revenue this month', s.revenueThisMonth || '$0', '<span class="ctx">Live from GHL</span>');
    updateStat('new leads', String(s.newLeads ?? 0), '<span class="ctx">Live contacts/opps</span>');
    updateStat('jobs booked today', String(s.jobsBookedToday ?? 0), '<span class="ctx">Live calendar</span>');
    updateStat('emergency calls', String(s.emergencyCalls ?? 0), '<span class="ctx">Live matching</span>');
    updateStat('avg. ticket size', s.avgTicket || '$0', '<span class="ctx">Closed jobs</span>');
    updateStat('google rating', s.googleRating || '—', s.reviewCount ? `<span class="ctx">${escapeHtml(s.reviewCount)} reviews</span>` : '<span class="ctx">Connect GBP/manual field</span>');
  }

  function renderFunnel(data) {
    const funnelEl = $('#dash-funnel');
    if (!funnelEl || !Array.isArray(data.funnel)) return;
    const rows = data.funnel.filter(x => (x.count || x.value));
    if (!rows.length) return;
    const max = Math.max(...rows.map(s => Number(s.count || 0)), 1);
    funnelEl.innerHTML = rows.map((s, i) => {
      const pct = Math.max(14, Math.round(((s.count || 0) / max) * 100));
      const color = s.color || ['#2557E8','#5B33B8','#B9791A','#146E9E','#1C9B6B'][i % 5];
      return `<div class="funnel-row">
        <div class="funnel-label">${escapeHtml(s.label)}</div>
        <div class="funnel-bar-track"><div class="funnel-bar-fill" style="width:${pct}%;background:${color};">${Number(s.count || 0)}</div></div>
      </div>`;
    }).join('');
  }

  function renderBoard(data) {
    const board = $('.board');
    if (!board || !Array.isArray(data.board)) return;
    const cols = data.board.filter(c => c.count || (c.cards || []).length);
    if (!cols.length) return;
    board.innerHTML = cols.map((col) => {
      const cards = (col.cards || []).slice(0, 12).map(card => {
        const tag = card.tag ? `<span class="job-tag" style="background:var(--critical-soft);color:var(--critical);">${escapeHtml(card.tag)}</span>` : '';
        return `<div class="job-card" data-opportunity-id="${escapeHtml(card.id || '')}">
          ${tag}
          <div class="job-title">${escapeHtml(card.title)}</div>
          <div class="job-meta"><span>${escapeHtml(card.customer || 'Customer')}</span><span class="job-amount">${escapeHtml(card.amount || '—')}</span></div>
        </div>`;
      }).join('') || '<div class="cell-sub" style="padding:8px;">No live cards in this stage</div>';
      return `<div>
        <div class="board-col-head"><h3>${escapeHtml(col.label)}</h3><span class="board-col-total">${Number(col.count || 0)} · ${formatMoney(col.total || 0)}</span></div>
        <div class="board-col">${cards}</div>
      </div>`;
    }).join('');
  }

  function pillClass(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('paid') || s.includes('won') || s.includes('success')) return 'pill-paid';
    if (s.includes('approved')) return 'pill-approved';
    if (s.includes('sent') || s.includes('open')) return 'pill-sent';
    if (s.includes('overdue') || s.includes('late')) return 'pill-overdue';
    return 'pill-draft';
  }

  function renderInvoices(data) {
    const tbody = $('#sec-estimates tbody');
    if (!tbody || !Array.isArray(data.invoices)) return;
    if (!data.invoices.length) return;
    tbody.innerHTML = data.invoices.map(row => `<tr>
      <td class="cell-primary">${escapeHtml(row.job)}</td>
      <td>${escapeHtml(row.customer)}</td>
      <td>${escapeHtml(row.type || 'Invoice')}</td>
      <td class="num">${escapeHtml(row.amountText || formatMoney(row.amount || 0))}</td>
      <td><span class="pill ${pillClass(row.status)}">${escapeHtml(row.status || 'Open')}</span></td>
      <td>${escapeHtml(row.date || '')}</td>
    </tr>`).join('');
  }

  function renderTodaySchedule(data) {
    const table = $('#sec-dashboard .row-2b .card table tbody');
    if (!table || !Array.isArray(data.appointments)) return;
    const today = todayKey();
    const rows = data.appointments.filter(a => a.startTime && a.startTime.slice(0,10) === today).slice(0, 8);
    if (!rows.length) return;
    table.innerHTML = rows.map(a => `<tr>
      <td style="width:70px;font-family:var(--mono);font-weight:700;">${escapeHtml(formatTime(a.startTime))}</td>
      <td><div class="cell-primary">${escapeHtml(a.title)}${a.customer ? ' — ' + escapeHtml(a.customer) : ''}</div><div class="cell-sub">${escapeHtml(a.address || 'No address')} · ${escapeHtml(a.technician || 'Unassigned')}</div></td>
      <td><span class="pill pill-scheduled">${escapeHtml(a.type || 'Booking')}</span></td>
    </tr>`).join('');
  }

  function getWeekDays() {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    monday.setHours(0,0,0,0);
    return Array.from({length: 5}).map((_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      return d;
    });
  }

  function renderCalendar(data) {
    const grid = $('#sec-booking .cal-grid');
    if (!grid || !Array.isArray(data.appointments) || !data.appointments.length) return;
    const days = getWeekDays();
    const dayLabels = days.map(d => d.toLocaleDateString('en-US', { weekday:'short', day:'numeric' }));
    const groups = new Map();
    data.appointments.forEach(a => {
      const tech = a.technician || 'Live Bookings';
      if (!groups.has(tech)) groups.set(tech, []);
      groups.get(tech).push(a);
    });
    const techs = Array.from(groups.keys()).slice(0, 6);
    grid.innerHTML = `<div class="cal-head techcol">Technician</div>${dayLabels.map(l => `<div class="cal-head">${escapeHtml(l)}</div>`).join('')}` +
      techs.map((tech, idx) => {
        const color = ['#2557E8','#5B33B8','#146E9E','#1C9B6B','#B9791A','#D8433D'][idx % 6];
        const initials = tech.split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase() || 'LB';
        const cells = days.map(day => {
          const key = todayKey(day);
          const appts = groups.get(tech).filter(a => a.startTime && a.startTime.slice(0,10) === key).slice(0,3);
          const chips = appts.map(a => `<div class="appt-chip" style="background:${color};"><span class="t">${escapeHtml(formatTime(a.startTime))}</span>${escapeHtml(a.title || 'Booking')}</div>`).join('');
          return `<div class="cal-cell">${chips}</div>`;
        }).join('');
        return `<div class="cal-tech-row"><div class="tech-avatar" style="background:${color};">${escapeHtml(initials)}</div><span class="tech-name">${escapeHtml(tech)}</span></div>${cells}`;
      }).join('');
  }

  function drawLineChart(canvas, labels, values, color){
    if (!canvas || !labels.length) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const cssH = Number(canvas.getAttribute('height') || 190);
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const padL = 46, padR = 14, padT = 14, padB = 26;
    const w = cssW - padL - padR, h = cssH - padT - padB;
    const maxV = Math.max(...values, 1000) * 1.15;
    ctx.clearRect(0,0,cssW,cssH);
    ctx.strokeStyle = '#E3E7EE'; ctx.lineWidth = 1; ctx.font = '10.5px -apple-system,Segoe UI,sans-serif'; ctx.fillStyle = '#8891A0';
    for(let i=0;i<=4;i++){
      const y = padT + h - (h*i/4);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL+w, y); ctx.stroke();
      const val = Math.round(maxV*i/4);
      ctx.fillText('$' + (val>=1000? Math.round(val/1000)+'k' : val), 4, y+3);
    }
    const pts = values.map((v,i) => [padL + (w*i/Math.max(values.length-1,1)), padT + h - (v/maxV)*h]);
    const grad = ctx.createLinearGradient(0,padT,0,padT+h);
    grad.addColorStop(0, color+'33'); grad.addColorStop(1, color+'02');
    ctx.beginPath(); ctx.moveTo(pts[0][0], padT+h); pts.forEach(p => ctx.lineTo(p[0],p[1])); ctx.lineTo(pts[pts.length-1][0], padT+h); ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
    ctx.beginPath(); pts.forEach((p,i) => i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1])); ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.stroke();
    pts.forEach((p,i) => { ctx.beginPath(); ctx.arc(p[0],p[1],i===pts.length-1?4:2.5,0,Math.PI*2); ctx.fillStyle=i===pts.length-1?color:'#fff'; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle=color; ctx.stroke(); ctx.fillStyle='#8891A0'; ctx.textAlign='center'; ctx.fillText(labels[i], p[0], cssH-6); });
    ctx.textAlign='left';
  }

  function drawBarChart(canvas, items){
    if (!canvas || !items.length) return;
    const labels = items.map(i => String(i.label || 'Other').slice(0,10));
    const values = items.map(i => moneyNumber(i.value));
    const colors = items.map((i, idx) => i.color || ['#2557E8','#5B33B8','#146E9E','#B9791A','#1C9B6B','#D8433D'][idx % 6]);
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 500;
    const cssH = Number(canvas.getAttribute('height') || 200);
    canvas.width = cssW*dpr; canvas.height = cssH*dpr; canvas.style.width=cssW+'px'; canvas.style.height=cssH+'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr);
    const padL=46, padR=14, padT=14, padB=34;
    const w=cssW-padL-padR, h=cssH-padT-padB;
    const maxV=Math.max(...values,1000)*1.15;
    ctx.clearRect(0,0,cssW,cssH);
    ctx.strokeStyle='#E3E7EE'; ctx.font='10.5px -apple-system,Segoe UI,sans-serif'; ctx.fillStyle='#8891A0';
    for(let i=0;i<=4;i++){ const y=padT+h-(h*i/4); ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(padL+w,y); ctx.stroke(); const val=Math.round(maxV*i/4); ctx.fillText('$'+(val>=1000?Math.round(val/1000)+'k':val),4,y+3); }
    const bw = w/labels.length*0.55;
    labels.forEach((lab,i) => { const cx=padL+w*(i+.5)/labels.length; const bh=(values[i]/maxV)*h; const x=cx-bw/2, y=padT+h-bh; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x,y,bw,bh,5) : ctx.rect(x,y,bw,bh); ctx.fillStyle=colors[i]; ctx.fill(); ctx.fillStyle='#101826'; ctx.font='11px SFMono-Regular,Consolas,monospace'; ctx.textAlign='center'; ctx.fillText('$'+Math.round(values[i]/1000)+'k',cx,y-6); ctx.fillStyle='#5B6472'; ctx.font='10.5px -apple-system,Segoe UI,sans-serif'; ctx.fillText(lab,cx,cssH-14); });
  }

  function renderReports(data) {
    const rev = data.reports?.monthlyRevenue || [];
    if (rev.length) {
      const labels = rev.map(x => x.label);
      const values = rev.map(x => moneyNumber(x.value));
      drawLineChart($('#chart-revenue'), labels, values, '#2557E8');
      drawLineChart($('#chart-revenue-2'), labels, values, '#2557E8');
    }
    const service = data.reports?.serviceBreakdown || [];
    if (service.length) {
      drawBarChart($('#chart-services'), service);
      const legend = $('#services-legend');
      if (legend) legend.innerHTML = service.map((s,i) => `<div class="legend-item"><span class="legend-sw" style="background:${escapeHtml(s.color || '#2557E8')};"></span>${escapeHtml(s.label)}</div>`).join('');
    }
    const lb = data.reports?.technicianLeaderboard || [];
    const card = $('#sec-reports .card:last-child');
    if (card && lb.length) {
      const title = $('.section-title-row', card)?.outerHTML || '<div class="section-title-row"><h2>Technician leaderboard — this month</h2></div>';
      card.innerHTML = title + lb.map((r, i) => `<div class="leaderboard-row">
        <span class="lb-rank">${i+1}</span>
        <div class="lb-name"><strong>${escapeHtml(r.name)}</strong><span>${Number(r.jobs || 0)} jobs completed</span></div>
        <div class="lb-metric">${formatMoney(r.revenue || 0)}<span>revenue</span></div>
        <div class="lb-metric">${escapeHtml(r.rating || '—')}<span>rating</span></div>
      </div>`).join('');
    }
  }

  function ensureBookingFields() {
    const panel = $('.booking-panel');
    if (!panel || $('#live-email-field')) return;
    const customerField = $('.field', panel);
    if (!customerField) return;
    const email = document.createElement('div');
    email.className = 'field'; email.id = 'live-email-field';
    email.innerHTML = '<label>Email</label><input type="email" placeholder="customer@email.com">';
    const phone = document.createElement('div');
    phone.className = 'field'; phone.id = 'live-phone-field';
    phone.innerHTML = '<label>Phone</label><input type="tel" placeholder="+1 555 000 0000">';
    customerField.insertAdjacentElement('afterend', email);
    email.insertAdjacentElement('afterend', phone);
    const hint = panel.querySelector('p');
    if (hint) hint.textContent = 'Live form — creates contact and booking when calendar ID is configured.';
  }

  async function submitBooking() {
    const panel = $('.booking-panel');
    if (!panel) return;
    const fields = $$('.field', panel);
    const customerName = $('input', fields[0])?.value || '';
    const email = $('#live-email-field input')?.value || '';
    const phone = $('#live-phone-field input')?.value || '';
    const serviceType = $('select', fields.find(f => $('label', f)?.textContent.toLowerCase().includes('service')))?.value || 'Plumbing Service';
    const startTime = $('input', fields.find(f => $('label', f)?.textContent.toLowerCase().includes('date')))?.value || '';
    const address = $('input', fields.find(f => $('label', f)?.textContent.toLowerCase().includes('address')))?.value || '';
    setStatus('warn', 'Creating booking in GHL...');
    const res = await fetch(`${API_BASE}/create-booking`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ customerName, email, phone, serviceType, startTime, address })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok) throw new Error(payload.message || 'Booking failed');
    setStatus('ok', payload.warnings?.length ? payload.warnings[0] : 'Booking/contact created successfully in GHL.');
    setTimeout(loadDashboard, 1200);
  }

  function hookBooking() {
    ensureBookingFields();
    const confirm = $('#booking-confirm');
    if (!confirm || confirm.dataset.liveHooked) return;
    confirm.dataset.liveHooked = '1';
    confirm.addEventListener('click', function(e){
      e.preventDefault();
      submitBooking().catch(err => setStatus('error', err.message));
    });
  }

  async function loadDashboard() {
    setStatus('warn', 'Loading live GHL dashboard...');
    const res = await fetch(`${API_BASE}/dashboard`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    latestDashboard = data;
    if (!data.connected) {
      setStatus('error', data.message || 'GHL not connected yet. Check environment variables/scopes.');
      return;
    }
    updateBrand(data);
    renderStats(data);
    renderFunnel(data);
    renderBoard(data);
    renderInvoices(data);
    renderTodaySchedule(data);
    renderCalendar(data);
    renderReports(data);
    setStatus('ok', `Live GHL connected · ${data.rawCounts?.opportunities || 0} opportunities · ${data.rawCounts?.appointments || 0} appointments`);
  }

  window.GHLDashboard = {
    refresh: loadDashboard,
    latest: () => latestDashboard
  };

  document.addEventListener('DOMContentLoaded', function(){
    hookBooking();
    loadDashboard().catch(err => setStatus('error', err.message));
    setInterval(() => loadDashboard().catch(err => setStatus('error', err.message)), 5 * 60 * 1000);
  });
})();
