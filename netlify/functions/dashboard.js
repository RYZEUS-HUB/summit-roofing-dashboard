const {
  getConfig,
  json,
  tryGhl,
  extractArray,
  asNumber,
  parseDate,
  startOfMonth,
  startOfToday,
  fmtMoney,
  monthKey,
  safeText
} = require('./_lib/ghl');

const COLORS = ['#2557E8', '#5B33B8', '#B9791A', '#146E9E', '#1C9B6B', '#D8433D', '#8891A0'];

function normalizeContactName(contact) {
  return contact?.name || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.email || contact?.phone || 'Unknown customer';
}

function normalizeOpportunityName(opp) {
  return opp?.name || opp?.title || opp?.opportunityName || opp?.contact?.name || 'Untitled opportunity';
}

function normalizeOpportunityValue(opp) {
  return asNumber(opp?.monetaryValue ?? opp?.value ?? opp?.amount ?? opp?.price ?? opp?.opportunityValue, 0);
}

function opportunityDate(opp) {
  return parseDate(opp?.updatedAt || opp?.createdAt || opp?.dateAdded || opp?.lastStatusChangeAt);
}

function invoiceDate(inv) {
  return parseDate(inv?.createdAt || inv?.updatedAt || inv?.dueDate || inv?.date || inv?.invoiceDate);
}

function invoiceAmount(inv) {
  return asNumber(inv?.total || inv?.amount || inv?.amountDue || inv?.grandTotal || inv?.balance || inv?.paidAmount, 0);
}

function isPaid(inv) {
  const s = String(inv?.status || inv?.paymentStatus || '').toLowerCase();
  return s.includes('paid') || s === 'success' || asNumber(inv?.paidAmount, 0) > 0;
}

function normalizeAppointment(event) {
  const start = parseDate(event?.startTime || event?.start || event?.startDate || event?.eventStartTime || event?.appointmentStartTime);
  const end = parseDate(event?.endTime || event?.end || event?.endDate || event?.eventEndTime || event?.appointmentEndTime);
  return {
    id: event?.id || event?._id || event?.eventId || '',
    title: event?.title || event?.name || event?.calendarName || event?.appointmentTitle || 'Appointment',
    customer: event?.contactName || event?.contact?.name || event?.customerName || event?.fullName || '',
    address: event?.address || event?.location || event?.meetingLocation || '',
    technician: event?.assignedUserName || event?.userName || event?.ownerName || event?.assignedTo || 'Live Bookings',
    calendarId: event?.calendarId || '',
    startTime: start ? start.toISOString() : '',
    endTime: end ? end.toISOString() : '',
    type: event?.type || event?.serviceType || event?.status || 'Booking',
    rawStatus: event?.status || ''
  };
}

function choosePipeline(pipelines, envPipelineId) {
  if (!pipelines.length) return null;
  if (envPipelineId) {
    const match = pipelines.find(p => p.id === envPipelineId || p._id === envPipelineId);
    if (match) return match;
  }
  const plumbing = pipelines.find(p => /plumb/i.test(p.name || p.title || ''));
  return plumbing || pipelines[0];
}

function normalizeStages(pipeline, opportunities) {
  const rawStages = pipeline?.stages || pipeline?.pipelineStages || pipeline?.stagesList || [];
  let stages = Array.isArray(rawStages) ? rawStages.map((s, i) => ({
    id: s.id || s._id || s.stageId || s.name || `stage-${i}`,
    label: s.name || s.title || s.label || `Stage ${i + 1}`,
    color: COLORS[i % COLORS.length],
    sort: asNumber(s.position ?? s.order ?? s.sortOrder, i)
  })) : [];

  if (!stages.length) {
    const labels = ['New Lead', 'Contacted', 'Estimate Sent', 'Scheduled', 'Won'];
    stages = labels.map((label, i) => ({ id: label.toLowerCase().replace(/\s+/g, '-'), label, color: COLORS[i] }));
  }

  const stageById = Object.fromEntries(stages.map(s => [String(s.id), s]));
  opportunities.forEach(opp => {
    const sid = String(opp?.pipelineStageId || opp?.stageId || opp?.stage || '');
    const sname = opp?.pipelineStageName || opp?.stageName;
    if (sid && !stageById[sid] && sname) {
      const stage = { id: sid, label: sname, color: COLORS[stages.length % COLORS.length] };
      stages.push(stage);
      stageById[sid] = stage;
    }
  });
  return stages.sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

function buildBoard(stages, opportunities) {
  const cols = stages.map(stage => ({ ...stage, count: 0, total: 0, cards: [] }));
  const byId = Object.fromEntries(cols.map(c => [String(c.id), c]));
  const fallback = cols[0] || { id: 'new', label: 'New Lead', color: COLORS[0], count: 0, total: 0, cards: [] };
  opportunities.slice(0, 80).forEach(opp => {
    const sid = String(opp?.pipelineStageId || opp?.stageId || opp?.stage || '');
    const value = normalizeOpportunityValue(opp);
    const col = byId[sid] || fallback;
    col.count += 1;
    col.total += value;
    col.cards.push({
      id: opp?.id || opp?._id || '',
      title: normalizeOpportunityName(opp),
      customer: opp?.contact?.name || opp?.contactName || opp?.customerName || opp?.fullName || 'Customer',
      amount: value ? fmtMoney(value) : '—',
      value,
      status: opp?.status || 'open',
      tag: /emergency|urgent|burst|leak/i.test(JSON.stringify(opp)) ? 'Emergency' : ''
    });
  });
  return cols;
}

function monthlyRevenue(invoices, opportunities) {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ date: d, label: monthKey(d), value: 0 });
  }
  const add = (date, value) => {
    if (!date) return;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const m = months.find(x => `${x.date.getFullYear()}-${x.date.getMonth()}` === key);
    if (m) m.value += asNumber(value, 0);
  };
  invoices.filter(isPaid).forEach(inv => add(invoiceDate(inv), invoiceAmount(inv)));
  if (!months.some(m => m.value > 0)) {
    opportunities.filter(o => String(o.status || '').toLowerCase() === 'won').forEach(o => add(opportunityDate(o), normalizeOpportunityValue(o)));
  }
  return months.map(({ label, value }) => ({ label, value: Math.round(value) }));
}

function serviceBreakdown(opportunities, invoices) {
  const serviceMap = new Map();
  const candidates = opportunities.length ? opportunities : invoices;
  candidates.forEach((item) => {
    const text = `${item?.name || item?.title || item?.opportunityName || item?.description || item?.customerName || ''}`;
    let label = 'Other';
    if (/water heater|tankless|hot water/i.test(text)) label = 'Water Heaters';
    else if (/drain|clog/i.test(text)) label = 'Drain Cleaning';
    else if (/repipe|pipe/i.test(text)) label = 'Repipe/Pipe Repair';
    else if (/leak|slab/i.test(text)) label = 'Leak Repair';
    else if (/fixture|toilet|sink|faucet|spigot/i.test(text)) label = 'Fixtures';
    else if (/sewer|camera|septic/i.test(text)) label = 'Sewer/Septic';
    const amount = normalizeOpportunityValue(item) || invoiceAmount(item);
    serviceMap.set(label, (serviceMap.get(label) || 0) + amount);
  });
  const arr = Array.from(serviceMap, ([label, value], i) => ({ label, value: Math.round(value), color: COLORS[i % COLORS.length] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  return arr.length ? arr : [
    { label: 'Water Heaters', value: 0, color: COLORS[0] },
    { label: 'Drain Cleaning', value: 0, color: COLORS[1] },
    { label: 'Leak Repair', value: 0, color: COLORS[2] }
  ];
}

function technicianLeaderboard(appointments, opportunities) {
  const map = new Map();
  appointments.forEach(a => {
    const tech = a.technician || 'Unassigned';
    if (!map.has(tech)) map.set(tech, { name: tech, jobs: 0, revenue: 0, rating: '—' });
    map.get(tech).jobs += 1;
  });
  // If no tech data is available, use assigned user from opportunities where present.
  opportunities.forEach(o => {
    const tech = o.assignedToName || o.assignedUserName || o.ownerName;
    if (!tech) return;
    if (!map.has(tech)) map.set(tech, { name: tech, jobs: 0, revenue: 0, rating: '—' });
    map.get(tech).revenue += normalizeOpportunityValue(o);
  });
  return Array.from(map.values()).sort((a, b) => (b.revenue + b.jobs) - (a.revenue + a.jobs)).slice(0, 5);
}

function normalizeInvoiceRows(invoices, opportunities) {
  const rows = invoices.slice(0, 25).map(inv => ({
    id: inv?.id || inv?._id || '',
    job: inv?.title || inv?.name || inv?.invoiceNumber || 'Invoice',
    customer: inv?.contactName || inv?.customerName || inv?.contact?.name || 'Customer',
    type: 'Invoice',
    amount: invoiceAmount(inv),
    amountText: fmtMoney(invoiceAmount(inv)),
    status: inv?.status || inv?.paymentStatus || 'Open',
    date: invoiceDate(inv)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) || ''
  }));
  if (rows.length) return rows;
  return opportunities.slice(0, 25).map(opp => ({
    id: opp?.id || opp?._id || '',
    job: normalizeOpportunityName(opp),
    customer: opp?.contact?.name || opp?.contactName || 'Customer',
    type: 'Opportunity',
    amount: normalizeOpportunityValue(opp),
    amountText: normalizeOpportunityValue(opp) ? fmtMoney(normalizeOpportunityValue(opp)) : '—',
    status: opp?.status || 'open',
    date: opportunityDate(opp)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) || ''
  }));
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  const cfg = getConfig();

  if (!cfg.token) {
    return json(200, {
      connected: false,
      message: 'GHL_PRIVATE_TOKEN is not configured yet. Add it in Netlify environment variables, then redeploy.',
      locationId: cfg.locationId,
      companyName: cfg.companyName,
      divisionName: cfg.divisionName
    });
  }

  const now = new Date();
  const todayStart = startOfToday(now);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = startOfMonth(now);
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - todayStart.getDay() + 1);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [locationResult, contactsResult, pipelinesResult, oppsResult, calendarsResult] = await Promise.all([
    tryGhl('location', [{ path: `/locations/${cfg.locationId}` }]),
    tryGhl('contacts', [
      { path: '/contacts/', query: { locationId: cfg.locationId, limit: 100 } },
      { path: '/contacts/search', query: { locationId: cfg.locationId, limit: 100 } }
    ]),
    tryGhl('pipelines', [
      { path: '/opportunities/pipelines', query: { locationId: cfg.locationId } },
      { path: '/opportunities/pipelines', query: { location_id: cfg.locationId } }
    ]),
    tryGhl('opportunities', [
      { path: '/opportunities/search', query: { location_id: cfg.locationId, limit: 100 } },
      { path: '/opportunities/search', query: { locationId: cfg.locationId, limit: 100 } }
    ]),
    tryGhl('calendars', [
      { path: '/calendars/', query: { locationId: cfg.locationId } },
      { path: '/calendars/', query: { location_id: cfg.locationId } }
    ])
  ]);

  const contacts = extractArray(contactsResult.data, ['contacts']);
  const pipelines = extractArray(pipelinesResult.data, ['pipelines']);
  const opportunitiesAll = extractArray(oppsResult.data, ['opportunities', 'opportunity']);
  const calendars = extractArray(calendarsResult.data, ['calendars']);
  const pipeline = choosePipeline(pipelines, cfg.pipelineId);
  const opportunities = pipeline?.id || pipeline?._id
    ? opportunitiesAll.filter(o => !o.pipelineId || o.pipelineId === (pipeline.id || pipeline._id))
    : opportunitiesAll;

  const calendarId = cfg.calendarId || calendars[0]?.id || calendars[0]?._id || calendars[0]?.calendarId || '';

  const [eventsResult, invoicesResult] = await Promise.all([
    calendarId ? tryGhl('events', [
      { path: '/calendars/events', query: { locationId: cfg.locationId, calendarId, startTime: weekStart.getTime(), endTime: weekEnd.getTime() } },
      { path: '/calendars/events', query: { location_id: cfg.locationId, calendarId, startTime: weekStart.getTime(), endTime: weekEnd.getTime() } }
    ]) : Promise.resolve({ ok: false, label: 'events', data: null, errors: [{ message: 'No calendar found or GHL_CALENDAR_ID not set.' }] }),
    tryGhl('invoices', [
      { path: '/invoices/', query: { locationId: cfg.locationId, limit: 100 } },
      { path: '/payments/invoices', query: { locationId: cfg.locationId, limit: 100 } },
      { path: '/invoices/search', query: { locationId: cfg.locationId, limit: 100 } }
    ])
  ]);

  const rawEvents = extractArray(eventsResult.data, ['events', 'appointments', 'calendarEvents']);
  const appointments = rawEvents.map(normalizeAppointment).filter(a => a.startTime);
  const invoices = extractArray(invoicesResult.data, ['invoices', 'data']);

  const paidInvoicesThisMonth = invoices.filter(inv => isPaid(inv) && invoiceDate(inv) && invoiceDate(inv) >= monthStart);
  const wonOppsThisMonth = opportunities.filter(o => String(o.status || '').toLowerCase() === 'won' && opportunityDate(o) && opportunityDate(o) >= monthStart);
  const revenueThisMonth = paidInvoicesThisMonth.reduce((sum, inv) => sum + invoiceAmount(inv), 0) || wonOppsThisMonth.reduce((sum, o) => sum + normalizeOpportunityValue(o), 0);
  const closedCount = paidInvoicesThisMonth.length || wonOppsThisMonth.length;
  const avgTicket = closedCount ? revenueThisMonth / closedCount : 0;

  const newLeads = contacts.filter(c => {
    const d = parseDate(c.createdAt || c.dateAdded);
    return d && d >= monthStart;
  }).length || contacts.length || opportunities.filter(o => String(o.status || '').toLowerCase() === 'open').length;

  const jobsBookedToday = appointments.filter(a => {
    const d = parseDate(a.startTime);
    return d && d >= todayStart && d < todayEnd;
  }).length;

  const emergencyCalls = opportunities.filter(o => /emergency|urgent|burst|leak|no hot water/i.test(JSON.stringify(o))).length +
    appointments.filter(a => /emergency|urgent|burst|leak|no hot water/i.test(`${a.title} ${a.type}`)).length;

  const stages = normalizeStages(pipeline, opportunities);
  const board = buildBoard(stages, opportunities);
  const funnel = board.map((col, i) => ({ label: col.label, count: col.count, value: Math.round(col.total), color: col.color }));

  const debug = [locationResult, contactsResult, pipelinesResult, oppsResult, calendarsResult, eventsResult, invoicesResult].map(r => ({
    label: r.label,
    ok: r.ok,
    endpoint: r.endpoint || '',
    errors: r.errors || []
  }));

  return json(200, {
    connected: debug.some(d => d.ok),
    locationId: cfg.locationId,
    companyName: cfg.companyName,
    divisionName: cfg.divisionName,
    lastUpdated: now.toISOString(),
    stats: {
      revenueThisMonth: fmtMoney(revenueThisMonth),
      newLeads,
      jobsBookedToday,
      emergencyCalls,
      avgTicket: avgTicket ? fmtMoney(avgTicket) : '$0',
      googleRating: '—',
      reviewCount: ''
    },
    funnel,
    board,
    appointments,
    invoices: normalizeInvoiceRows(invoices, opportunities),
    reports: {
      monthlyRevenue: monthlyRevenue(invoices, opportunities),
      serviceBreakdown: serviceBreakdown(opportunities, invoices),
      technicianLeaderboard: technicianLeaderboard(appointments, opportunities)
    },
    rawCounts: {
      contacts: contacts.length,
      opportunities: opportunities.length,
      pipelines: pipelines.length,
      calendars: calendars.length,
      appointments: appointments.length,
      invoices: invoices.length
    },
    debug
  });
};
