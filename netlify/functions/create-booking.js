const { getConfig, json, ghlFetch, splitName } = require('./_lib/ghl');

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, message: 'Method not allowed' });

  const cfg = getConfig();
  if (!cfg.token) return json(500, { ok: false, message: 'GHL_PRIVATE_TOKEN is not configured.' });

  let input;
  try { input = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, message: 'Invalid JSON body.' }); }

  const customerName = String(input.customerName || input.name || '').trim();
  const email = String(input.email || '').trim();
  const phone = String(input.phone || '').trim();
  const serviceType = String(input.serviceType || input.service || 'Plumbing Service').trim();
  const address = String(input.address || '').trim();
  const startRaw = String(input.startTime || input.dateTime || '').trim();
  const start = startRaw ? new Date(startRaw) : null;

  if (!customerName) return json(400, { ok: false, message: 'Customer name is required.' });
  if (!email && !phone) return json(400, { ok: false, message: 'Email or phone is required to create/find a contact.' });
  if (!start || Number.isNaN(start.getTime())) return json(400, { ok: false, message: 'Valid startTime is required. Example: 2026-07-08T10:00:00-04:00' });

  const { firstName, lastName } = splitName(customerName);
  const tags = ['dashboard-booking', serviceType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')].filter(Boolean);

  try {
    const contact = await ghlFetch('/contacts/', {
      method: 'POST',
      body: {
        locationId: cfg.locationId,
        firstName,
        lastName,
        name: customerName,
        email: email || undefined,
        phone: phone || undefined,
        address1: address || undefined,
        source: 'Custom Dashboard',
        tags
      }
    });

    const contactId = contact?.contact?.id || contact?.id || contact?.contactId || contact?._id;
    const warnings = [];
    let appointment = null;
    let opportunity = null;

    if (cfg.calendarId && contactId) {
      const end = input.endTime ? new Date(input.endTime) : addMinutes(start, Number(input.durationMinutes || 60));
      appointment = await ghlFetch('/calendars/events/appointments', {
        method: 'POST',
        body: {
          calendarId: cfg.calendarId,
          locationId: cfg.locationId,
          contactId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          title: `${serviceType} — ${customerName}`,
          appointmentStatus: 'new',
          address: address || undefined,
          assignedUserId: cfg.assignedUserId || undefined
        }
      });
    } else if (!cfg.calendarId) {
      warnings.push('GHL_CALENDAR_ID is not set, so contact was created but appointment was not created.');
    }

    if (cfg.pipelineId && contactId) {
      try {
        opportunity = await ghlFetch('/opportunities/upsert', {
          method: 'POST',
          body: {
            locationId: cfg.locationId,
            pipelineId: cfg.pipelineId,
            name: `${serviceType} — ${customerName}`,
            status: 'open',
            contactId,
            monetaryValue: Number(input.value || 0) || undefined
          }
        });
      } catch (oppError) {
        warnings.push(`Opportunity was not created: ${oppError.message}`);
      }
    }

    return json(200, { ok: true, contact, appointment, opportunity, warnings });
  } catch (error) {
    return json(error.status || 500, {
      ok: false,
      message: error.message,
      details: error.data || null
    });
  }
};
