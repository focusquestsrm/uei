'use strict';

// Delivery schedule from the LeadHoop posting specs (campaign 12213), all in Eastern Time:
// Sunday paused; Monday-Saturday 09:00 - 21:00.
// The spec does not say whether 21:00 is inclusive. The window is treated as [09:00, 21:00):
// 09:00:00 is accepted and 21:00:00 is not, so no post is made at or after the stated end.
const TIME_ZONE = 'America/New_York';
const OPEN_MINUTE = 9 * 60;
const CLOSE_MINUTE = 21 * 60;
const OPEN_DAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

const MESSAGE = 'We are not accepting requests right now. Requests can be submitted Monday through Saturday, ' +
  '9:00 a.m. to 9:00 p.m. Eastern Time. Please come back during those hours.';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

// Daylight saving is handled by the time zone database, not by a fixed UTC offset.
function easternParts(date) {
  const parts = {};
  formatter.formatToParts(date).forEach(function (part) { parts[part.type] = part.value; });
  return { weekday: parts.weekday, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function isOpen(date) {
  const now = date instanceof Date ? date : new Date();
  if (Number.isNaN(now.getTime())) return false;
  const eastern = easternParts(now);
  return OPEN_DAYS.indexOf(eastern.weekday) !== -1 && eastern.minute >= OPEN_MINUTE && eastern.minute < CLOSE_MINUTE;
}

module.exports = { MESSAGE, TIME_ZONE, isOpen };
